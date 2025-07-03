'use strict';

const chalk = require('chalk');
const chokidar = require('chokidar');
const path = require('path');
const { minimatch } = require('minimatch');
const Utils = require('./utils');

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
    
    // 清理编译缓存并重新编译
    Utils.logInfo(this.hexo, '清理编译缓存并重新编译...', 'Server Mode');
    this.themeBuilder.clearCompileCache();
    
    // 初始编译
    await this.themeBuilder.compileAssets();
    
    // 初始化文件监听器
    this.initializeWatcher();
    
    Utils.logDebug(this.hexo, '服务器模式初始化完成', 'Server Mode');
  }

  /**
   * 注册服务器模式相关的事件处理器
   */
  registerEvents() {
    // generateBefore事件 - 服务器模式下确保同步编译完成
    this.hexo.on('generateBefore', async () => {
      Utils.logDebug(this.hexo, '==> generateBefore 事件触发，检查编译状态...', 'Server Mode');
      
      if (!this.themeBuilder.hasCompiled) {
        Utils.logDebug(this.hexo, '资源尚未编译，执行同步编译...', 'Server Mode');
        try {
          // 改为同步编译，确保在生成前完成
          await this.themeBuilder.compileAssets();
          Utils.logDebug(this.hexo, 'generateBefore 编译完成', 'Server Mode');
        } catch (error) {
          Utils.logError(this.hexo, 'generateBefore 编译失败:', error, 'Server Mode');
          throw error; // 抛出错误阻止生成过程
        }
      } else {
        Utils.logDebug(this.hexo, '资源已编译', 'Server Mode');
        
        // 服务器模式下，检查是否有待处理的文件变化编译
        if (this.compileDebounceTimer) {
          Utils.logInfo(this.hexo, '检测到待处理的文件变化，立即执行编译...', 'Server Mode');
          // 清除防抖定时器并立即执行编译
          clearTimeout(this.compileDebounceTimer);
          this.compileDebounceTimer = null;
          
          try {
            this.themeBuilder.clearCompileCache();
            await this.themeBuilder.compileAssets();
            Utils.logDebug(this.hexo, '文件变化编译完成', 'Server Mode');
          } catch (error) {
            Utils.logError(this.hexo, '文件变化编译失败:', error, 'Server Mode');
            throw error;
          }
        }
      }
    });

    // before_generate过滤器 - 同步处理，最高优先级
    this.hexo.extend.filter.register('before_generate', async () => {
      Utils.logDebug(this.hexo, '==> before_generate 过滤器执行...', 'Server Mode');
      
      if (!this.themeBuilder.hasCompiled && !this.themeBuilder.isCompiling) {
        Utils.logInfo(this.hexo, '执行同步编译...', 'Server Mode');
        try {
          await this.themeBuilder.compileAssets();
          Utils.logDebug(this.hexo, 'before_generate 编译完成', 'Server Mode');
        } catch (error) {
          Utils.logError(this.hexo, 'before_generate 编译失败:', error, 'Server Mode');
          throw error; // 抛出错误阻止生成过程
        }
      }
      
      // 确保监听器已初始化
      if (!this.watcherInitialized) {
        this.initializeWatcher();
      }
    }, 0); // 最高优先级

    // before_process过滤器
    this.hexo.extend.filter.register('before_process', () => {
      if (!this.watcherInitialized) {
        this.initializeWatcher();
      }
    });

    // before_server过滤器 - 修复：清理缓存后立即重新编译
    this.hexo.extend.filter.register('before_server', async () => {
      Utils.logInfo(this.hexo, '服务器启动前清理缓存并重新编译...', 'Server Mode');
      this.themeBuilder.clearCompileCache();
      
      try {
        // 立即重新编译，确保服务器启动时有资源文件
        await this.themeBuilder.compileAssets();
        Utils.logDebug(this.hexo, 'before_server 重新编译完成', 'Server Mode');
      } catch (error) {
        Utils.logError(this.hexo, 'before_server 编译失败:', error, 'Server Mode');
      }
      
      if (!this.watcherInitialized) {
        this.initializeWatcher();
      }
    });
  }

  /**
   * 检查文件变化是否需要重新编译
   */
  shouldRecompileForFileChange(relativePath) {
    // 获取用户配置的监听路径
    const themeBuilderConfig = this.hexo.config.theme_builder || {};
    const userWatchPaths = themeBuilderConfig.watch || [];
    
    // 需要重新编译的文件类型
    const needsRecompile = (
      // 主题相关文件
      relativePath.includes('layout') ||
      // 配置文件
      relativePath.endsWith('_config.yml') ||
      relativePath.endsWith('tailwind.config.js')
    );

    // 检查是否匹配用户配置的监听路径
    if (!needsRecompile && userWatchPaths.length > 0) {
      // 将相对路径转换为相对于主题目录的路径
      const relativeToTheme = path.relative(this.hexo.theme_dir, path.join(this.hexo.theme_dir, relativePath));
      
      // 检查是否匹配用户配置的任何监听路径
      for (const watchPattern of userWatchPaths) {
        if (minimatch(relativeToTheme, watchPattern)) {
          Utils.logDebug(this.hexo, `文件 ${relativePath} 匹配用户配置的监听路径 ${watchPattern}，需要重新编译`, 'Server Mode');
          return true;
        }
      }
    }

    return needsRecompile;
  }

  /**
   * 处理文件变化
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

    // 检查是否需要重新编译
    if (!this.shouldRecompileForFileChange(relativePath)) {
      Utils.logDebug(this.hexo, `文件变化不需要重新编译: ${relativePath}`, 'Server Mode');
      return;
    }

    // 如果正在编译中，忽略文件变化
    if (this.themeBuilder.isCompiling) {
      Utils.logDebug(this.hexo, `编译进行中，忽略文件变化: ${relativePath}`, 'Server Mode');
      return;
    }

    Utils.logInfo(this.hexo, `检测到需要重新编译的文件变化: ${eventType} -> ${relativePath}`, 'Server Mode');

    // 清除之前的防抖定时器
    if (this.compileDebounceTimer) {
      clearTimeout(this.compileDebounceTimer);
    }

    // 设置防抖延迟，避免频繁编译
    this.compileDebounceTimer = setTimeout(async () => {
      // 防止文件变化处理期间出现竞态条件
      if (this.themeBuilder.isCompiling) {
        Utils.logDebug(this.hexo, '编译正在进行中，跳过文件变化处理', 'Server Mode');
        return;
      }

      try {
        Utils.logInfo(this.hexo, '开始响应文件变化，重新编译...', 'Server Mode');
        
        // 清理编译缓存，确保全新编译
        this.themeBuilder.clearCompileCache();
        
        // 同步编译，确保完成后再继续
        await this.themeBuilder.compileAssets();
        
        Utils.logSuccess(this.hexo, '文件变化响应完成', 'Server Mode');
      } catch (error) {
        Utils.logError(this.hexo, '响应文件变化时编译失败:', error, 'Server Mode');
      }
    }, 300); // 300ms防抖延迟
  }

  /**
   * 处理配置文件变化
   */
  handleConfigChange() {
    Utils.logInfo(this.hexo, '检测到主题配置变化，重新加载配置...', 'Server Mode');
    this.themeBuilder.loadThemeConfig();
    // 触发重新编译
    this.themeBuilder.compileAssets();
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
            this.handleConfigChange();
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
   * 清理资源
   */
  cleanup() {
    this.stopWatcher();
  }
}

module.exports = ServerModeHandler; 