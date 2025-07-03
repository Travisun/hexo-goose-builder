'use strict';

const fs = require('fs');
const path = require('path');
const Utils = require('./lib/utils');
const ComponentJSBundler = require('./lib/js-bundler');
const TailwindCompiler = require('./lib/tailwind-compiler');
const ModeFactory = require('./lib/mode-factory');
const Banner = require('./lib/banner');
const chalk = require('chalk');
const yaml = require('js-yaml');

class ThemeBuilder {
  constructor(hexo) {
    this.hexo = hexo;
    this.hasCompiled = false;
    this.isCompiling = false;
    this.themeConfig = null;

    // 检测当前执行模式
    this.currentMode = this.detectExecutionMode();

    // 创建对应的模式处理器（优先创建，用于判断是否支持）
    this.modeHandler = ModeFactory.createHandler(this.currentMode, this);

    // 如果是不支持的模式，跳过大部分初始化
    if (!this.isSupportedMode()) {
      // 只进行最基本的初始化
      return;
    }

    // 初始化主题配置
    this.loadThemeConfig();

    // 初始化构建器组件
    this.jsBundler = new ComponentJSBundler(hexo);
    this.tailwindCompiler = new TailwindCompiler(hexo);
    this.banner = new Banner();

    // 绑定方法到实例
    this.compileAssets = this.compileAssets.bind(this);
    this.loadThemeConfig = this.loadThemeConfig.bind(this);
    this.clearCompileCache = this.clearCompileCache.bind(this);

    // 注册Hexo事件处理器
    this.registerHexoEvents();
    
    // 显示初始化消息
    this.banner.showStatus(this.currentMode, '初始化中...', 'info');
    this.logDebug(`模式特性: ${ModeFactory.getModeDescription(this.currentMode)}`);

    // 在静态生成模式下确保初始状态正确
    if (this.isStaticGenerationMode()) {
      this.logInfo(`检测到${this.currentMode}模式，重置编译状态...`);
      this.hasCompiled = false;
      this.isCompiling = false;
    }
  }

  // 检查是否启用调试模式
  isDebugEnabled() {
    const config = this.hexo.config;
    return config && config.theme_builder && config.theme_builder.debug === true;
  }

  // 统一的日志输出方法
  logInfo(message) {
    // 总是显示重要信息
    console.log(chalk.blue(`[Theme Builder] ${message}`));
  }

  logSuccess(message) {
    // 总是显示成功信息
    console.log(chalk.green(`[Theme Builder] ✓ ${message}`));
  }

  logError(message, error = null) {
    // 总是显示错误信息
    console.error(chalk.red(`[Theme Builder] ❌ ${message}`), error || '');
  }

  logWarning(message) {
    // 总是显示警告信息
    console.warn(chalk.yellow(`[Theme Builder] ⚠ ${message}`));
  }

  logDebug(message) {
    // 只在调试模式下显示详细信息
    if (this.isDebugEnabled()) {
      console.log(chalk.gray(`[Theme Builder] ${message}`));
    }
  }

  // 安全的调试模式检查（处理不支持模式下可能的未初始化问题）
  isDebugEnabledSafe() {
    try {
      return this.isDebugEnabled();
    } catch (error) {
      return false;
    }
  }

  // 检测执行模式
  detectExecutionMode() {
    const cmd = this.hexo.env.cmd;
    
    if (cmd === 'server' || cmd === 's') {
      return 'server';
    } else if (cmd === 'generate' || cmd === 'g') {
      return 'generate';
    } else if (cmd === 'deploy' || cmd === 'd') {
      return 'deploy';
    } else {
      return cmd || 'unknown';
    }
  }

  // 检查是否为支持的模式
  isSupportedMode() {
    return ModeFactory.isSupportedMode(this.currentMode);
  }

  // 检查是否为服务器模式
  isServerMode() {
    return this.currentMode === 'server';
  }

  // 检查是否为静态生成模式（包括generate和deploy）
  isStaticGenerationMode() {
    return this.currentMode === 'generate' || this.currentMode === 'deploy';
  }

  // 检查是否为部署模式
  isDeployMode() {
    return this.currentMode === 'deploy';
  }

  // 加载主题配置
  loadThemeConfig() {
    try {
      const configPath = path.join(this.hexo.theme_dir, '_config.yml');
      if (fs.existsSync(configPath)) {
        const configContent = fs.readFileSync(configPath, 'utf8');
        this.themeConfig = yaml.load(configContent);
        this.logSuccess('成功加载主题配置');
        
        if (this.isDebugEnabled()) {
          this.logDebug('主题配置: ' + JSON.stringify(this.themeConfig, null, 2));
        }
      } else {
        this.logWarning('主题配置文件不存在: ' + configPath);
        this.themeConfig = {};
      }
    } catch (error) {
      this.logError('加载主题配置失败:', error);
      this.themeConfig = {};
    }
  }

  // 获取主题配置
  getThemeConfig() {
    return this.themeConfig || {};
  }

  // 显示欢迎banner
  showWelcomeBanner() {
    // 在不支持的模式下不显示横幅
    if (!this.isSupportedMode()) {
      return;
    }
    this.banner.show(this.currentMode);
  }

  // 编译资源文件
  async compileAssets() {
    // 防止重复编译
    if (this.isCompiling) {
      this.logDebug(`编译正在进行中（${this.currentMode}模式），等待完成...`);
      // 等待当前编译完成
      while (this.isCompiling) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      return this.hasCompiled;
    }

    this.isCompiling = true;
    this.logInfo(`开始编译主题资源（${this.currentMode}模式）...`);
    
    try {
      // 检查主题目录是否存在
      if (!fs.existsSync(this.hexo.theme_dir)) {
        throw new Error(`主题目录不存在: ${this.hexo.theme_dir}`);
      }

      // 为部署模式提供额外信息
      if (this.isDeployMode()) {
        console.log(chalk.cyan('[Theme Builder] Deploy模式：确保所有资源都是最新编译状态...'));
      }

      // 先编译 CSS，因为 JS 可能依赖于生成的样式类
      this.logInfo(`编译 TailwindCSS（${this.currentMode}模式）...`);
      const cssOutputPath = await this.tailwindCompiler.compile();
      if (cssOutputPath) {
                  this.logDebug(`TailwindCSS编译完成（${this.currentMode}模式）`);
        
        // 等待文件系统同步 - 确保文件写入完成
        await new Promise(resolve => setTimeout(resolve, 200));
        
        // 再编译 JS
        this.logInfo(`编译 JS组件（${this.currentMode}模式）...`);
        const bundleResult = await this.jsBundler.bundle();
        if (bundleResult) {
                      this.logDebug(`JS组件打包完成（${this.currentMode}模式）`);
        } else {
                      this.logWarning(`JS组件打包未成功（${this.currentMode}模式），但继续执行`);
        }
      } else {
                  this.logWarning(`TailwindCSS编译未成功（${this.currentMode}模式）`);
      }

      this.hasCompiled = true;
      
              // 为不同模式提供不同的完成信息
        if (this.isDeployMode()) {
          this.banner.showComplete(this.currentMode, '编译');
          this.logSuccess(`Deploy模式：所有资源编译完成，准备部署`);
        } else if (this.isStaticGenerationMode()) {
          this.banner.showComplete(this.currentMode, '编译');
          this.logSuccess(`${this.currentMode}模式：所有资源编译完成`);
        } else {
          this.banner.showComplete(this.currentMode, '编译');
          this.logSuccess(`所有资源编译完成`);
        }
      
      return true;
    } catch (error) {
      this.banner.showError(this.currentMode, '资源编译失败');
      this.logError(`资源编译失败（${this.currentMode}模式）:`, error);
      this.hasCompiled = false;
      throw error; // 重新抛出错误供调用者处理
    } finally {
      this.isCompiling = false;
    }
  }

  // 验证编译后的资源文件是否存在
  async verifyCompiledAssets() {
    this.logInfo(`验证编译后的资源文件（${this.currentMode}模式）...`);
    
    try {
      const cssDir = path.join(this.hexo.theme_dir, 'source/css');
      const jsDir = path.join(this.hexo.theme_dir, 'source/js');
      
      let cssFound = false;
      let jsFound = false;
      
      // 检查CSS文件
      if (fs.existsSync(cssDir)) {
        const cssFiles = fs.readdirSync(cssDir);
        const componentCssFiles = cssFiles.filter(file => {
          return (
            file.match(/^components\.styles\.[a-f0-9]{8}\.css$/) ||
            file.match(/^components\.bundle\.[a-z0-9]{6}\.css$/) ||
            file.match(/^component\.bundle\.[a-z0-9]{6}\.css$/)
          );
        });
        cssFound = componentCssFiles.length > 0;
        if (cssFound) {
          this.logSuccess(`找到CSS文件（${this.currentMode}模式）: ${componentCssFiles.join(', ')}`);
        }
      }
      
      // 检查JS文件
      if (fs.existsSync(jsDir)) {
        const jsFiles = fs.readdirSync(jsDir);
        const componentJsFiles = jsFiles.filter(file => 
          file.startsWith('components.') && file.endsWith('.js') && !file.includes('loader')
        );
        jsFound = componentJsFiles.length > 0;
        if (jsFound) {
          this.logSuccess(`找到JS文件（${this.currentMode}模式）: ${componentJsFiles.join(', ')}`);
        }
      }
      
      if (!cssFound && !jsFound) {
        this.logWarning(`未找到编译后的资源文件（${this.currentMode}模式），可能编译未成功`);
        this.hasCompiled = false;
        throw new Error(`编译验证失败（${this.currentMode}模式）：未找到编译后的资源文件`);
      } else {
                  // 为不同模式提供不同的验证通过信息
          if (this.isDeployMode()) {
            this.logSuccess(`Deploy模式：资源文件验证通过，可以安全部署`);
          } else {
            this.logSuccess(`${this.currentMode}模式：资源文件验证通过`);
          }
      }
      
    } catch (error) {
      this.logError(`验证编译资源时出错（${this.currentMode}模式）:`, error);
      throw error;
    }
  }

  // 清理编译缓存
  clearCompileCache() {
    this.logInfo(`正在清理编译缓存（${this.currentMode}模式）...`);
    
    try {
      const themeSourceDir = path.join(this.hexo.theme_dir, 'source');
      const cssDir = path.join(themeSourceDir, 'css');
      const jsDir = path.join(themeSourceDir, 'js');
      
      let clearedCount = 0;
      
      // 清理CSS编译文件
      if (fs.existsSync(cssDir)) {
        const cssFiles = fs.readdirSync(cssDir);
        const compiledCssFiles = cssFiles.filter(file => {
          return (
            file.match(/^components\.styles\.[a-f0-9]{8}\.css$/) ||
            file.match(/^components\.bundle\.[a-z0-9]{6}\.css$/) ||
            file.match(/^component\.bundle\.[a-z0-9]{6}\.css$/)
          );
        });
        
        compiledCssFiles.forEach(file => {
          const filePath = path.join(cssDir, file);
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            this.logDebug(`已删除CSS缓存文件: ${file}`);
            clearedCount++;
          }
        });
      }
      
      // 清理JS编译文件
      if (fs.existsSync(jsDir)) {
        const jsFiles = fs.readdirSync(jsDir);
        const compiledJsFiles = jsFiles.filter(file => {
          return file.startsWith('components.') && file.endsWith('.js');
        });
        
        compiledJsFiles.forEach(file => {
          const filePath = path.join(jsDir, file);
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            this.logDebug(`已删除JS缓存文件: ${file}`);
            clearedCount++;
          }
        });
      }
      
      // 清理组件manifest文件
      const manifestPath = path.join(jsDir, 'components.manifest.json');
      if (fs.existsSync(manifestPath)) {
        fs.unlinkSync(manifestPath);
        this.logDebug(`已删除组件manifest文件`);
        clearedCount++;
      }
      
      // 重置编译状态
      this.hasCompiled = false;
      this.isCompiling = false;
      
      // 清除编译定时器
      if (this.compileDebounceTimer) {
        clearTimeout(this.compileDebounceTimer);
        this.compileDebounceTimer = null;
      }
      
              // 为不同模式提供不同的完成信息
        if (this.isDeployMode()) {
          this.banner.showComplete(this.currentMode, '缓存清理');
          this.logDebug(`Deploy模式：编译缓存清理完成，已清理 ${clearedCount} 个文件，准备全新编译`);
        } else {
          this.banner.showComplete(this.currentMode, '缓存清理');
          this.logDebug(`${this.currentMode}模式：编译缓存清理完成，已清理 ${clearedCount} 个文件`);
        }
      
    } catch (error) {
      this.logError(`清理编译缓存失败（${this.currentMode}模式）:`, error);
    }
  }

  // 注册Hexo事件处理器
  registerHexoEvents() {
    // 让模式处理器先注册其特定的事件（包括early ready事件）
    if (this.modeHandler && typeof this.modeHandler.registerEvents === 'function') {
      this.modeHandler.registerEvents();
    }

    // 在Hexo初始化完成时执行（在模式处理器的ready事件之后）
    this.hexo.on('ready', async () => {
      this.showWelcomeBanner();
      
      // 使用模式处理器初始化
      try {
        await this.modeHandler.initialize();
      } catch (error) {
        this.logError('模式处理器初始化失败:', error);
      }
    });

    // 在Hexo退出时清理资源
    this.hexo.on('exit', () => {
      if (this.modeHandler && typeof this.modeHandler.cleanup === 'function') {
        this.modeHandler.cleanup();
      }
    });

    // 处理进程信号
    const handleExit = () => {
      if (this.modeHandler && typeof this.modeHandler.cleanup === 'function') {
        this.modeHandler.cleanup();
      }
      process.exit(0);
    };

    // 移除可能存在的旧处理器
    process.removeListener('SIGINT', handleExit);
    process.removeListener('SIGTERM', handleExit);
    
    // 添加新的处理器
    process.on('SIGINT', handleExit);
    process.on('SIGTERM', handleExit);
  }

  // 获取资源HTML标签
  getAssetTags() {
    // 如果是不支持的模式，直接返回空数组
    if (!this.isSupportedMode()) {
      return [];
    }
    
    const tags = [];
    
    try {
      // 添加组件样式
      const cssDir = path.join(this.hexo.theme_dir, 'source/css');
      if (fs.existsSync(cssDir)) {
        const cssFiles = fs.readdirSync(cssDir);
        
        // 获取所有组件相关的CSS文件
        const componentCssFiles = cssFiles.filter(file => {
          // 匹配所有可能的组件样式文件命名模式
          return (
            file.match(/^components\.styles\.[a-f0-9]{8}\.css$/) ||  // 匹配 components.styles.xxxxxxxx.css
            file.match(/^components\.bundle\.[a-f0-9]{6}\.css$/) ||  // 匹配 components.bundle.xxxxxx.css
            file.match(/^component\.bundle\.[a-z0-9]{6}\.css$/)      // 匹配 component.bundle.xxxxxx.css
          );
        });

        // 按照文件名排序，确保加载顺序一致
        componentCssFiles.sort().forEach(file => {
          this.logDebug(`${this.currentMode}模式加载样式: ${file}`);
          tags.push(`<link rel="stylesheet" href="/css/${file}">`);
        });
        
        if (componentCssFiles.length === 0) {
          this.logWarning(`${this.currentMode}模式：未找到编译后的CSS文件`);
        }
      } else {
        this.logWarning(`CSS目录不存在: ${cssDir}`);
      }
      
      // 添加组件脚本
      const jsDir = path.join(this.hexo.theme_dir, 'source/js');
      if (fs.existsSync(jsDir)) {
        const files = fs.readdirSync(jsDir);
        
        // 获取所有 components. 开头的 JS 文件
        const componentFiles = files
          .filter(file => file.startsWith('components.') && file.endsWith('.js') && !file.includes('loader'))
          .sort((a, b) => {
            // 尝试从文件名中提取数字进行排序
            const getNumber = (filename) => {
              const match = filename.match(/components\.([^.]+)/);
              return match ? match[1] : '';
            };
            const numA = getNumber(a);
            const numB = getNumber(b);
            return numA.localeCompare(numB);
          });
        
        // 添加所有组件脚本，使用type="module"
        componentFiles.forEach(file => {
          this.logDebug(`${this.currentMode}模式加载脚本: ${file}`);
          tags.push(`<script type="module" src="/js/${file}"></script>`);
        });
        
        if (componentFiles.length === 0) {
          this.logWarning(`${this.currentMode}模式：未找到编译后的JS文件`);
        }
      } else {
        this.logWarning(`JS目录不存在: ${jsDir}`);
      }
      
      if (tags.length === 0) {
        this.logWarning(`未找到任何编译后的资源文件（${this.currentMode}模式），请检查编译是否成功`);
        
        // 让模式处理器处理资源缺失的情况
        if (this.modeHandler && typeof this.modeHandler.handleGetAssetTags === 'function') {
          this.modeHandler.handleGetAssetTags();
        }
      } else {
                  this.logSuccess(`${this.currentMode}模式：成功加载 ${tags.length} 个资源标签`);
      }
    } catch (error) {
      this.logError(`获取资源标签时出错:`, error);
    }
     
    return tags;
  }
}

// 创建主题构建器实例
const themeBuilder = new ThemeBuilder(hexo);

// 注册helper用于加载主题资源
hexo.extend.helper.register('load_theme_assets', () => {
  return themeBuilder.getAssetTags().join('\n');
});