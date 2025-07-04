'use strict';

const chalk = require('chalk');
const chokidar = require('chokidar');
const path = require('path');
const { minimatch } = require('minimatch');
const Utils = require('./utils');
const { Server } = require('socket.io');
const http = require('http');

/**
 * 服务器模式处理器
 * 专门处理 hexo server 模式下的逻辑
 */
class ServerModeHandler {
  constructor(themeBuilder) {
    this.themeBuilder = themeBuilder;
    this.hexo = themeBuilder.hexo;
    this.watcher = null;
    this.isWatching = false;
    this.watcherInitialized = false;
    this.initializingWatcher = false; // 防止并发初始化的标志
    this.compileDebounceTimer = null;
    this.lastChangedFile = null; // 跟踪最后改变的文件
    
    // Socket.IO 相关属性
    this.io = null;
    this.socketServer = null;
    this.socketPort = null;
    this.connectedClients = new Set();

    // 编译策略常量
    this.COMPILE_STRATEGIES = {
      FULL: 'full',           // 完整编译（TailwindCSS + 模块编译）
      CSS_ONLY: 'css_only',   // 仅编译TailwindCSS
      JS_ONLY: 'js_only',     // 仅执行模块编译
      SKIP: 'skip'            // 跳过编译
    };

    // 绑定方法到实例
    this.initializeWatcher = this.initializeWatcher.bind(this);
    this.stopWatcher = this.stopWatcher.bind(this);
    this.handleFileChange = this.handleFileChange.bind(this);
  }

  /**
   * 初始化服务器模式
   */
  async initialize() {
    Utils.logInfo(this.hexo, '初始化服务器模式处理器...', 'Server Mode');
    
    // 输出用户配置的监听和忽略路径信息
    const themeBuilderConfig = this.hexo.config.theme_builder || {};
    const userWatchPaths = themeBuilderConfig.watch || [];
    const userIgnorePaths = themeBuilderConfig.ignore || [];
    
    if (userWatchPaths.length > 0) {
      Utils.logInfo(this.hexo, `用户配置的监听路径: ${userWatchPaths.join(', ')}`, 'Server Mode');
    }
    
    if (userIgnorePaths.length > 0) {
      Utils.logInfo(this.hexo, `用户配置的忽略路径: ${userIgnorePaths.join(', ')}`, 'Server Mode');
    }
    
    // 初始化时刷新数据库，确保与文件系统同步
    await this.refreshHexoDatabase('服务器模式初始化');
    
    // 清理编译缓存并重新编译
    Utils.logInfo(this.hexo, '清理编译缓存并重新编译...', 'Server Mode');
    this.themeBuilder.clearCompileCache();
    
    // 初始编译
    await this.themeBuilder.compileAssets();
    
    // 初始化文件监听器
    this.initializeWatcher();
    
    // 启动Socket.IO服务
    await this.startSocketService();
    
    Utils.logDebug(this.hexo, '服务器模式初始化完成', 'Server Mode');
  }

  /**
   * 注册服务器模式相关的事件处理器
   */
  registerEvents() {
    // before_generate过滤器 - 统一编译处理入口，最高优先级
    this.hexo.extend.filter.register('before_generate', async () => {
      Utils.logDebug(this.hexo, '==> before_generate 过滤器执行...', 'Server Mode');
      
      // 1. 首先处理待编译的文件变化
      if (this.compileDebounceTimer) {
        Utils.logInfo(this.hexo, '检测到待处理的文件变化，立即执行编译...', 'Server Mode');
        
        // 清除防抖定时器
        clearTimeout(this.compileDebounceTimer);
        this.compileDebounceTimer = null;
        
        try {
          // 获取编译策略
          const filePath = this.lastChangedFile;
          let strategy;
          
          if (filePath) {
            strategy = this.determineCompileStrategy(filePath);
            Utils.logDebug(this.hexo, `使用文件 ${filePath} 的编译策略: ${strategy}`, 'Server Mode');
          } else {
            strategy = this.COMPILE_STRATEGIES.FULL;
            Utils.logDebug(this.hexo, '没有特定文件变化，使用完整编译策略', 'Server Mode');
          }
          
          // 执行编译策略
          await this.executeCompileStrategy(strategy, filePath);
          Utils.logDebug(this.hexo, '文件变化编译完成', 'Server Mode');
          
          // 编译完成后确保数据库同步
          await this.refreshHexoDatabase('before_generate文件变化编译完成');
        } catch (error) {
          Utils.logError(this.hexo, '文件变化编译失败:', error, 'Server Mode');
          throw error;
        } finally {
          // 清理最后改变的文件路径
          this.lastChangedFile = null;
        }
      } 
      // 2. 检查是否需要初始编译
      else if (!this.themeBuilder.hasCompiled && !this.themeBuilder.isCompiling) {
        Utils.logInfo(this.hexo, '执行初始编译...', 'Server Mode');
        try {
          await this.themeBuilder.compileAssets();
          Utils.logDebug(this.hexo, 'before_generate 初始编译完成', 'Server Mode');
          
          // 初始编译完成后刷新数据库
          await this.refreshHexoDatabase('before_generate初始编译完成');
        } catch (error) {
          Utils.logError(this.hexo, 'before_generate 初始编译失败:', error, 'Server Mode');
          throw error;
        }
      } else {
        Utils.logDebug(this.hexo, '资源已编译或正在编译中，跳过编译', 'Server Mode');
      }
      
      // 3. 确保监听器已初始化
      if (!this.watcherInitialized) {
        this.initializeWatcher();
      }
    }, 0); // 最高优先级

    // before_process过滤器 - 确保监听器初始化
    this.hexo.extend.filter.register('before_process', () => {
      Utils.logDebug(this.hexo, '==> before_process 过滤器执行...', 'Server Mode');
      if (!this.watcherInitialized) {
        this.initializeWatcher();
      }
    });

    // before_server过滤器 - 服务器启动时的初始化
    this.hexo.extend.filter.register('before_server', async () => {
      Utils.logInfo(this.hexo, '==> before_server 过滤器执行，服务器启动前初始化...', 'Server Mode');
      
      // 清理编译缓存
      this.themeBuilder.clearCompileCache();
      
      try {
        // 执行初始编译，确保服务器启动时有资源文件
        await this.themeBuilder.compileAssets();
        Utils.logDebug(this.hexo, 'before_server 初始编译完成', 'Server Mode');
        
        // 初始编译完成后刷新数据库
        await this.refreshHexoDatabase('before_server初始编译完成');
      } catch (error) {
        Utils.logError(this.hexo, 'before_server 编译失败:', error, 'Server Mode');
      }
      
      // 确保监听器已初始化
      if (!this.watcherInitialized) {
        this.initializeWatcher();
      }
    });
  }

  /**
   * 获取编译策略配置
   */
  getCompileStrategyConfig() {
    const themeBuilderConfig = this.hexo.config.theme_builder || {};
    const strategyConfig = themeBuilderConfig.compile_strategy || {};
    
    // 默认编译策略配置 - 正确版本
    const defaultConfig = {
      // 仅JS编译的文件模式（仅执行模块编译并重载）
      js_only: [
        'layout/components/**/*.js',       // 组件目录下的js文件
        'layout/components/**/*.ejs'       // 组件目录下的ejs文件
      ],
      // 仅CSS编译的文件模式（仅重载编译 TailwindCSS流程）
      css_only: [
        'layout/*.ejs',                    // 主题布局根目录的ejs文件（影响样式）
        'layout/styles/**/*.ejs',          // styles目录下的ejs文件（影响样式）
        'layout/_partial*/**/*.ejs',       // partial目录下的ejs文件（影响样式）
        'layout/tailwind.css',             // 主要的tailwind样式文件
        'layout/**/*.css'                   // layout子目录下的css文件
        // 注意：tailwind.config.js 在determineCompileStrategy中特殊处理
      ],
      // 完整编译的文件模式（同时执行TailwindCSS编译和模块编译流程）
      full_compile: [
        '_config.yml'                      // 主题配置文件
        // 注意：hexo根目录的_config.yml在determineCompileStrategy中特殊处理
      ],
      // 忽略的文件模式
      ignore: [
        'source/css/components.*',         // 编译输出的CSS文件
        'source/css/component.*',          // 编译输出的CSS文件  
        'source/js/components.*',          // 编译输出的JS文件
        '**/.git/**',                      // Git版本控制文件
        '**/node_modules/**',              // Node.js模块目录
        '**/*.manifest.json'               // 组件清单文件
      ]
    };

    // 合并用户配置和默认配置
    return {
      css_only: [...defaultConfig.css_only, ...(strategyConfig.css_only || [])],
      js_only: [...defaultConfig.js_only, ...(strategyConfig.js_only || [])],
      full_compile: [...defaultConfig.full_compile, ...(strategyConfig.full_compile || [])],
      ignore: [...defaultConfig.ignore, ...(strategyConfig.ignore || [])]
    };
  }

  /**
   * 检查文件路径是否匹配模式列表
   */
  matchesPatterns(filePath, patterns) {
    const relativePath = path.relative(this.hexo.theme_dir, filePath);
    const normalizedPath = relativePath.replace(/\\/g, '/');
    
    for (const pattern of patterns) {
      if (minimatch(normalizedPath, pattern)) {
        return true;
      }
    }
    return false;
  }

  /**
   * 决定编译策略（扩展版本）
   */
  determineCompileStrategy(filePath) {
    const relativePath = path.relative(this.hexo.theme_dir, filePath);
    const normalizedPath = relativePath.replace(/\\/g, '/'); // 处理Windows路径
    
    Utils.logDebug(this.hexo, `分析文件路径: ${normalizedPath}`, 'Server Mode');

    // 获取编译策略配置
    const strategyConfig = this.getCompileStrategyConfig();

    // 1. 检查是否在忽略列表中
    if (this.matchesPatterns(filePath, strategyConfig.ignore)) {
      Utils.logDebug(this.hexo, '文件在忽略列表中，跳过编译', 'Server Mode');
      return this.COMPILE_STRATEGIES.SKIP;
    }

    // 2. 特殊处理跨目录文件
    const relativeToHexoBase = path.relative(this.hexo.base_dir, filePath);
    const normalizedHexoPath = relativeToHexoBase.replace(/\\/g, '/');
    
    // 2.1 检查Hexo根目录的特殊文件
    if (normalizedHexoPath === 'tailwind.config.js') {
      Utils.logDebug(this.hexo, '检测到Hexo根目录的tailwind.config.js，使用CSS编译模式', 'Server Mode');
      return this.COMPILE_STRATEGIES.CSS_ONLY;
    }
    
    if (normalizedHexoPath === '_config.yml') {
      Utils.logDebug(this.hexo, '检测到Hexo根目录的_config.yml，使用完整编译模式', 'Server Mode');
      return this.COMPILE_STRATEGIES.FULL;
    }

    // 3. 先检查更具体的JS编译模式（组件目录优先）
    if (this.matchesPatterns(filePath, strategyConfig.js_only)) {
      Utils.logDebug(this.hexo, '匹配JS编译模式', 'Server Mode');
      return this.COMPILE_STRATEGIES.JS_ONLY;
    }

    // 4. 检查是否需要完整编译
    if (this.matchesPatterns(filePath, strategyConfig.full_compile)) {
      Utils.logDebug(this.hexo, '匹配完整编译模式', 'Server Mode');
      return this.COMPILE_STRATEGIES.FULL;
    }

    // 5. 检查是否仅需要CSS编译
    if (this.matchesPatterns(filePath, strategyConfig.css_only)) {
      Utils.logDebug(this.hexo, '匹配CSS编译模式', 'Server Mode');
      return this.COMPILE_STRATEGIES.CSS_ONLY;
    }

    // 6. 检查用户配置的监听路径（向后兼容）
    const themeBuilderConfig = this.hexo.config.theme_builder || {};
    const userWatchPaths = themeBuilderConfig.watch || [];
    
    if (userWatchPaths.length > 0) {
      const relativeToTheme = path.relative(this.hexo.theme_dir, filePath);
      
      for (const watchPattern of userWatchPaths) {
        if (minimatch(relativeToTheme, watchPattern)) {
          Utils.logDebug(this.hexo, `文件匹配用户配置监听路径 ${watchPattern}，使用完整编译`, 'Server Mode');
          return this.COMPILE_STRATEGIES.FULL;
        }
      }
    }

    // 7. 默认跳过编译
    Utils.logDebug(this.hexo, '文件变化不需要重新编译', 'Server Mode');
    return this.COMPILE_STRATEGIES.SKIP;
  }

  /**
   * 执行编译策略
   */
  async executeCompileStrategy(strategy, filePath) {
    const relativePath = filePath ? path.relative(this.hexo.theme_dir, filePath) : '未知文件';
    
    try {
      // 在执行编译策略前，尝试清理可能的陈旧Warehouse记录
      await this.safeExecuteWithWarehouseCleanup(async () => {
        switch (strategy) {
          case this.COMPILE_STRATEGIES.FULL:
            Utils.logInfo(this.hexo, `执行完整编译 (TailwindCSS + 模块编译): ${relativePath}`, 'Server Mode');
            this.themeBuilder.clearCompileCache();
            await this.themeBuilder.compileAssets();
            Utils.logSuccess(this.hexo, '完整编译完成', 'Server Mode');
            
            // 完整编译后刷新数据库
            await this.refreshHexoDatabase('完整编译完成');
            
            // 通知客户端重载
            this.broadcastReload({
              strategy: 'full',
              changedFile: relativePath,
              message: 'TailwindCSS和模块编译完成，页面即将重新加载'
            });
            break;

          case this.COMPILE_STRATEGIES.CSS_ONLY:
            Utils.logInfo(this.hexo, `执行TailwindCSS编译: ${relativePath}`, 'Server Mode');
            Utils.logInfo(this.hexo, '🔧 使用强制重新编译模式，确保组件CSS文件变化生效', 'Server Mode');
            // CSS编译器会自动清理相关的CSS文件
            // 在服务器模式下强制重新编译，避免组件CSS缓存问题
            Utils.logInfo(this.hexo, '📞 调用 compileCSSOnly({ forceRecompile: true })', 'Server Mode');
            const compileResult = await this.themeBuilder.compileCSSOnly({ forceRecompile: true });
            Utils.logInfo(this.hexo, `CSS编译结果: ${compileResult ? '✅ 成功' : '❌ 失败'}`, 'Server Mode');
            Utils.logSuccess(this.hexo, 'TailwindCSS编译完成', 'Server Mode');
            
            // TailwindCSS编译完成后刷新数据库
            await this.refreshHexoDatabase('TailwindCSS编译完成');
            
            // 通知客户端重载
            this.broadcastReload({
              strategy: 'css_only',
              changedFile: relativePath,
              message: 'TailwindCSS编译完成，页面即将重新加载'
            });
            break;

          case this.COMPILE_STRATEGIES.JS_ONLY:
            Utils.logInfo(this.hexo, `执行模块编译: ${relativePath}`, 'Server Mode');
            // JS编译器会自动清理相关的JS文件和组件CSS文件
            // 在服务器模式下强制重新编译，确保组件变化生效
            await this.themeBuilder.compileJSOnly({ forceRecompile: true });
            Utils.logSuccess(this.hexo, '模块编译完成', 'Server Mode');
            
            // 模块编译完成后刷新数据库
            await this.refreshHexoDatabase('模块编译完成');
            
            // 通知客户端重载
            this.broadcastReload({
              strategy: 'js_only',
              changedFile: relativePath,
              message: '模块编译完成，页面即将重新加载'
            });
            break;

          case this.COMPILE_STRATEGIES.SKIP:
            Utils.logDebug(this.hexo, `跳过编译: ${relativePath}`, 'Server Mode');
            break;

          default:
            Utils.logWarning(this.hexo, `未知编译策略: ${strategy}`, 'Server Mode');
            break;
        }
      });
    } catch (error) {
      Utils.logError(this.hexo, `执行编译策略 ${strategy} 失败:`, error, 'Server Mode');
      throw error;
    }
  }

  /**
   * 刷新 Hexo 数据库
   * 确保 warehouse 数据库与文件系统保持同步
   */
  async refreshHexoDatabase(context = '') {
    try {
      Utils.logDebug(this.hexo, `刷新 Hexo 数据库: ${context}`, 'Server Mode');
      
      // 重新加载数据库以确保数据同步
      await this.hexo.database.load();
      
      // 保存数据库状态
      // await this.hexo.database.save();
      
      Utils.logDebug(this.hexo, `数据库刷新完成 (版本: ${this.hexo.database.version})`, 'Server Mode');
    } catch (error) {
      // 数据库刷新失败不应阻断流程，记录警告即可
      Utils.logWarning(this.hexo, `数据库刷新失败 (${context}): ${error.message}`, 'Server Mode');
    }
  }

  /**
   * 处理文件删除操作
   */
  async handleFileDelete(filePath) {
    const relativePath = path.relative(this.hexo.theme_dir, filePath);
    
    try {
      Utils.logInfo(this.hexo, `处理文件删除: ${relativePath}`, 'Server Mode');
      
      // 检查是否是主题文件
      if (filePath.startsWith(this.hexo.theme_dir)) {
        // 刷新数据库以移除已删除文件的记录
        await this.refreshHexoDatabase(`文件删除: ${relativePath}`);
        
        // 清理可能的编译缓存
        this.themeBuilder.clearCompileCache();
      }
      
    } catch (error) {
      Utils.logWarning(this.hexo, `处理文件删除失败: ${relativePath} - ${error.message}`, 'Server Mode');
    }
  }

  /**
   * 处理文件创建操作
   */
  async handleFileAdd(filePath) {
    const relativePath = path.relative(this.hexo.theme_dir, filePath);
    
    try {
      Utils.logInfo(this.hexo, `处理文件创建: ${relativePath}`, 'Server Mode');
      
      // 检查是否是主题文件
      if (filePath.startsWith(this.hexo.theme_dir)) {
        // 刷新数据库以加载新创建的文件
        await this.refreshHexoDatabase(`文件创建: ${relativePath}`);
      }
      
    } catch (error) {
      Utils.logWarning(this.hexo, `处理文件创建失败: ${relativePath} - ${error.message}`, 'Server Mode');
    }
  }

  /**
   * 安全执行操作，在遇到WarehouseError时自动清理并重试
   */
  async safeExecuteWithWarehouseCleanup(operation) {
    try {
      await operation();
    } catch (error) {
      // 检查是否是WarehouseError
      if (error.name === 'WarehouseError' && error.message.includes('does not exist')) {
        Utils.logWarning(this.hexo, `检测到 WarehouseError: ${error.message}`, 'Server Mode');
        Utils.logInfo(this.hexo, '尝试清理陈旧的文件记录并重试...', 'Server Mode');
        
        try {
          // 先尝试刷新数据库
          await this.refreshHexoDatabase('WarehouseError清理');
          
          // 获取TailwindCompiler实例并执行同步
          if (this.themeBuilder.tailwindCompiler) {
            this.themeBuilder.tailwindCompiler.syncHexoFileSystem();
            Utils.logInfo(this.hexo, '文件系统同步完成，重试操作...', 'Server Mode');
            
            // 重试操作
            await operation();
            Utils.logSuccess(this.hexo, '重试操作成功', 'Server Mode');
          } else {
            Utils.logWarning(this.hexo, 'TailwindCompiler 实例不可用，无法自动清理', 'Server Mode');
            throw error; // 重新抛出原始错误
          }
        } catch (retryError) {
          Utils.logError(this.hexo, '清理后重试仍然失败:', retryError, 'Server Mode');
          Utils.logWarning(this.hexo, '忽略此错误并继续执行...', 'Server Mode');
          // 不再抛出错误，避免阻断后续流程
        }
      } else {
        // 非WarehouseError，正常抛出
        throw error;
      }
    }
  }

  /**
   * 检查文件变化是否需要重新编译（已重构）
   */
  shouldRecompileForFileChange(relativePath) {
    // 使用新的编译策略决策器
    const strategy = this.determineCompileStrategy(path.join(this.hexo.theme_dir, relativePath));
    return strategy !== this.COMPILE_STRATEGIES.SKIP;
  }

  /**
   * 处理文件变化（优化版本）
   */
  handleFileChange(eventType, filePath) {
    // 忽略编译输出文件的变化，避免无限循环
    const relativePath = path.relative(this.hexo.theme_dir, filePath);
    const isCompiledFile = (
      relativePath.includes('source/css/components.') ||
      relativePath.includes('source/css/component.') ||
      relativePath.includes('source/js/components.') ||
      relativePath.includes('.manifest.json') ||
      relativePath.includes('node_modules') ||
      relativePath.includes('.git')
    );

    if (isCompiledFile) {
      Utils.logDebug(this.hexo, `忽略编译输出文件变化: ${relativePath}`, 'Server Mode');
      return;
    }

    // 检查是否在用户配置的忽略路径中
    const themeBuilderConfig = this.hexo.config.theme_builder || {};
    const userIgnorePaths = themeBuilderConfig.ignore || [];
    
    if (userIgnorePaths.length > 0) {
      const relativeToTheme = path.relative(this.hexo.theme_dir, filePath);
      
      for (const ignorePattern of userIgnorePaths) {
        if (minimatch(relativeToTheme, ignorePattern)) {
          Utils.logDebug(this.hexo, `文件 ${relativePath} 匹配用户配置的忽略路径 ${ignorePattern}，忽略变化`, 'Server Mode');
          return;
        }
      }
    }

    // 根据事件类型进行特殊处理
    if (eventType === 'unlink') {
      // 文件删除时立即处理
      this.handleFileDelete(filePath);
    } else if (eventType === 'add') {
      // 文件创建时立即处理
      this.handleFileAdd(filePath);
    }

    // 决定编译策略
    const compileStrategy = this.determineCompileStrategy(filePath);
    
    if (compileStrategy === this.COMPILE_STRATEGIES.SKIP) {
      Utils.logDebug(this.hexo, `文件变化不需要重新编译: ${relativePath}`, 'Server Mode');
      return;
    }

    // 如果正在编译中，忽略文件变化
    if (this.themeBuilder.isCompiling) {
      Utils.logDebug(this.hexo, `编译进行中，忽略文件变化: ${relativePath}`, 'Server Mode');
      return;
    }

    Utils.logInfo(this.hexo, `检测到文件变化: ${eventType} -> ${relativePath} (策略: ${compileStrategy})`, 'Server Mode');

    // 更新最后改变的文件路径
    this.lastChangedFile = filePath;

    // 清除之前的防抖定时器
    if (this.compileDebounceTimer) {
      clearTimeout(this.compileDebounceTimer);
      Utils.logDebug(this.hexo, '清除之前的防抖定时器', 'Server Mode');
    }

    // 设置防抖延迟 - 只设置标记，不立即执行编译
    // 编译将在下次生成过程中的 before_generate 过滤器中统一处理
    this.compileDebounceTimer = setTimeout(() => {
      Utils.logDebug(this.hexo, `文件变化防抖完成: ${relativePath}，等待生成过程处理编译`, 'Server Mode');
      // 防抖完成后，定时器会被设置为有效状态
      // 在 before_generate 过滤器中会检查并处理这个编译请求
    }, 300); // 300ms防抖延迟

    Utils.logDebug(this.hexo, `文件变化防抖定时器已设置，将在生成过程中处理编译`, 'Server Mode');
  }

  /**
   * 处理配置文件变化
   */
  async handleConfigChange(filePath) {
    Utils.logInfo(this.hexo, '检测到配置文件变化，重新加载配置...', 'Server Mode');
    
    try {
      // 先刷新数据库以确保配置变化被正确识别
      await this.refreshHexoDatabase(`配置文件变化: ${path.relative(this.hexo.base_dir, filePath)}`);
      
      // 重新加载主题配置
      this.themeBuilder.loadThemeConfig();
      
      // 配置文件变化通常需要完整重新编译
      Utils.logInfo(this.hexo, `配置文件变化: ${path.relative(this.hexo.base_dir, filePath)}`, 'Server Mode');
      
      // 配置变化触发完整编译
      const strategy = this.COMPILE_STRATEGIES.FULL;
      Utils.logDebug(this.hexo, `配置文件变化使用编译策略: ${strategy}`, 'Server Mode');
      
      await this.executeCompileStrategy(strategy, filePath);
      Utils.logSuccess(this.hexo, '配置文件变化处理完成', 'Server Mode');
    } catch (error) {
      Utils.logError(this.hexo, '处理配置文件变化失败:', error, 'Server Mode');
      throw error;
    }
  }

  /**
   * 初始化文件监听器
   */
  initializeWatcher() {
    if (this.watcherInitialized || this.isWatching) {
      Utils.logDebug(this.hexo, '监听器已初始化，跳过重复初始化', 'Server Mode');
      return;
    }

    // 防止并发初始化
    if (this.initializingWatcher) {
      Utils.logDebug(this.hexo, '监听器正在初始化中，等待完成...', 'Server Mode');
      return;
    }
    
    this.initializingWatcher = true;

    try {
      // 监听的目录和文件
      const watchPaths = [
        path.join(this.hexo.theme_dir, 'layout/**/*'),           // 监听整个 layout 目录
        path.join(this.hexo.theme_dir, '_config.yml'),
        path.join(this.hexo.base_dir, 'tailwind.config.js'),
        path.join(this.hexo.base_dir, '_config.yml')
      ];

      // 读取用户配置的额外监听路径
      const themeBuilderConfig = this.hexo.config.theme_builder || {};
      const userWatchPaths = themeBuilderConfig.watch || [];
      const userIgnorePaths = themeBuilderConfig.ignore || [];

      // 添加用户配置的监听路径（相对于主题目录）
      if (Array.isArray(userWatchPaths) && userWatchPaths.length > 0) {
        userWatchPaths.forEach(watchPath => {
          // 确保路径是相对于主题目录的
          const fullPath = path.join(this.hexo.theme_dir, watchPath);
          watchPaths.push(fullPath);
          Utils.logDebug(this.hexo, `添加用户配置的监听路径: ${fullPath}`, 'Server Mode');
        });
      }

      Utils.logDebug(this.hexo, '初始化文件监听器...', 'Server Mode');
      Utils.logDebug(this.hexo, `监听路径: ${watchPaths.join(', ')}`, 'Server Mode');

      // 基本忽略规则
      const ignoredPatterns = [
        /node_modules/,
        /\.git/,
        /source\/css\/components\./,
        /source\/css\/component\./,
        /source\/js\/components\./,
        /\.manifest\.json$/
      ];

      // 添加用户配置的忽略路径
      if (Array.isArray(userIgnorePaths) && userIgnorePaths.length > 0) {
        userIgnorePaths.forEach(ignorePath => {
          // 将字符串路径转换为正则表达式
          const fullPath = path.join(this.hexo.theme_dir, ignorePath);
          const escapeRegExp = (string) => string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const regexPattern = new RegExp(escapeRegExp(fullPath));
          ignoredPatterns.push(regexPattern);
          Utils.logDebug(this.hexo, `添加用户配置的忽略路径: ${fullPath}`, 'Server Mode');
        });
      }

      this.watcher = chokidar.watch(watchPaths, {
        ignored: ignoredPatterns,
        persistent: true,
        ignoreInitial: true,
        followSymlinks: false,
        usePolling: false,
        interval: 300,
        binaryInterval: 300,
        disableGlobbing: false
      });

      this.watcher
        .on('ready', () => {
          Utils.logSuccess(this.hexo, '文件监听器已就绪', 'Server Mode');
          this.isWatching = true;
          this.watcherInitialized = true;
          this.initializingWatcher = false; // 重置初始化标志
        })
        .on('change', (path) => {
          if (path.endsWith('_config.yml')) {
            this.handleConfigChange(path);
          } else {
            this.handleFileChange('change', path);
          }
        })
        .on('add', (path) => {
          this.handleFileChange('add', path);
        })
        .on('unlink', (path) => {
          this.handleFileChange('unlink', path);
        })
        .on('error', (error) => {
          Utils.logError(this.hexo, '文件监听器出错:', error, 'Server Mode');
          this.initializingWatcher = false; // 重置初始化标志
          
          // 尝试重新初始化监听器
          this.stopWatcher();
          setTimeout(() => {
            Utils.logInfo(this.hexo, '尝试重新初始化文件监听器...', 'Server Mode');
            this.initializeWatcher();
          }, 2000);
        });

    } catch (error) {
      Utils.logError(this.hexo, '初始化文件监听器失败:', error, 'Server Mode');
      this.initializingWatcher = false; // 重置初始化标志
    }
  }

  /**
   * 停止文件监听
   */
  stopWatcher() {
    if (this.watcher) {
      try {
        Utils.logInfo(this.hexo, '正在停止文件监听...', 'Server Mode');
        this.watcher.close();
        this.watcher = null;
        this.isWatching = false;
        this.watcherInitialized = false;
        this.initializingWatcher = false; // 重置初始化标志
        Utils.logSuccess(this.hexo, '已停止文件监听', 'Server Mode');
      } catch (error) {
        Utils.logError(this.hexo, '停止文件监听失败:', error, 'Server Mode');
      }
    }

    // 清除防抖定时器
    if (this.compileDebounceTimer) {
      clearTimeout(this.compileDebounceTimer);
      this.compileDebounceTimer = null;
    }
  }

  /**
   * 获取资源标签的服务器模式特殊处理
   */
  handleGetAssetTags() {
    // 服务器模式下，如果没有找到资源且还未编译，记录警告但不触发编译
    // 编译应该在生成过程开始前就完成，而不是在获取资源标签时
    if (!this.themeBuilder.hasCompiled && !this.themeBuilder.isCompiling) {
      Utils.logWarning(this.hexo, '获取资源标签时发现资源未编译，这可能是初始化时序问题', 'Server Mode');
      Utils.logWarning(this.hexo, '建议检查编译是否在generateBefore或before_generate中正确完成', 'Server Mode');
    }
  }

  /**
   * 启动Socket.IO服务
   */
  async startSocketService() {
    try {
      // 获取配置
      const themeBuilderConfig = this.hexo.config.theme_builder || {};
      const socketConfig = themeBuilderConfig.socket || {};
      
      // 默认端口为4000（Hexo默认端口）+ 1000，或用户自定义端口
      const defaultPort = (this.hexo.config.port || 4000) + 1000;
      this.socketPort = socketConfig.port || defaultPort;
      
      // 创建HTTP服务器
      this.socketServer = http.createServer();
      
      // 创建Socket.IO实例
      this.io = new Server(this.socketServer, {
        cors: {
          origin: `http://localhost:${this.hexo.config.port || 4000}`,
          methods: ["GET", "POST"],
          credentials: true
        },
        transports: ['websocket', 'polling']
      });
      
      // 监听连接事件
      this.io.on('connection', (socket) => {
        this.connectedClients.add(socket.id);
        Utils.logDebug(this.hexo, `Socket客户端连接: ${socket.id}`, 'Server Mode');
        
        // 监听断开连接事件
        socket.on('disconnect', () => {
          this.connectedClients.delete(socket.id);
          Utils.logDebug(this.hexo, `Socket客户端断开: ${socket.id}`, 'Server Mode');
        });
        
        // 发送欢迎消息
        socket.emit('connected', {
          message: 'Theme Builder热重载服务已连接',
          timestamp: Date.now()
        });
      });
      
      // 启动服务器
      await new Promise((resolve, reject) => {
        this.socketServer.listen(this.socketPort, (error) => {
          if (error) {
            reject(error);
          } else {
            Utils.logSuccess(this.hexo, `Socket.IO服务已启动，端口: ${this.socketPort}`, 'Server Mode');
            resolve();
          }
        });
      });
      
    } catch (error) {
      Utils.logError(this.hexo, 'Socket.IO服务启动失败:', error, 'Server Mode');
      throw error;
    }
  }

  /**
   * 停止Socket.IO服务
   */
  async stopSocketService() {
    try {
      if (this.io) {
        Utils.logInfo(this.hexo, '正在停止Socket.IO服务...', 'Server Mode');
        
        // 通知所有客户端服务即将关闭
        this.io.emit('server_shutdown', {
          message: '服务器即将关闭',
          timestamp: Date.now()
        });
        
        // 关闭所有连接
        this.io.close();
        this.io = null;
      }
      
      if (this.socketServer) {
        await new Promise((resolve) => {
          this.socketServer.close(() => {
            Utils.logSuccess(this.hexo, 'Socket.IO服务已停止', 'Server Mode');
            resolve();
          });
        });
        this.socketServer = null;
      }
      
      // 清空客户端集合
      this.connectedClients.clear();
      this.socketPort = null;
      
    } catch (error) {
      Utils.logError(this.hexo, '停止Socket.IO服务失败:', error, 'Server Mode');
    }
  }

  /**
   * 广播重载通知到所有连接的客户端
   */
  broadcastReload(compileInfo = {}) {
    if (!this.io || this.connectedClients.size === 0) {
      Utils.logDebug(this.hexo, 'Socket.IO服务未启动或无客户端连接，跳过重载通知', 'Server Mode');
      return;
    }
    
    const reloadData = {
      type: 'reload',
      timestamp: Date.now(),
      message: '资源文件已更新，正在重新加载...',
      ...compileInfo
    };
    
    Utils.logInfo(this.hexo, `通知 ${this.connectedClients.size} 个客户端重新加载页面`, 'Server Mode');
    this.io.emit('theme_reload', reloadData);
  }

  /**
   * 获取Socket.IO客户端连接信息
   */
  getSocketConnectionInfo() {
    return {
      port: this.socketPort,
      isRunning: !!this.io,
      clientCount: this.connectedClients.size
    };
  }

  /**
   * 清理资源
   */
  async cleanup() {
    this.stopWatcher();
    await this.stopSocketService(); // 停止Socket.IO服务
  }
}

module.exports = ServerModeHandler; 