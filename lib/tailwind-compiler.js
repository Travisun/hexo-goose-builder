'use strict';

const fs = require('fs');
const path = require('path');
const postcss = require('postcss');
const tailwindcss = require('@tailwindcss/postcss');
const cssnano = require('cssnano');
const Utils = require('./utils');
const chalk = require('chalk');
const cliProgress = require('cli-progress');
const chokidar = require('chokidar');
const yaml = require('js-yaml');
const glob = require('glob'); // 添加glob模块用于文件扫描

class TailwindCompiler {
  constructor(hexo) {
    this.hexo = hexo;
    this.isProcessing = false;
    this.currentCssFiles = new Set();
    this.componentStyles = new Map(); // 缓存组件样式文件
    
    // 初始化进度条
    this.progressBar = new cliProgress.SingleBar({
      format: '编译CSS |' + chalk.cyan('{bar}') + '| {percentage}% || {value}/{total} {unit}',
      barCompleteChar: '\u2588',
      barIncompleteChar: '\u2591',
      hideCursor: true
    });
  }

  // 读取主题配置文件
  readThemeConfig() {
    try {
      const configPath = path.join(this.hexo.theme_dir, '_config.yml');
      if (!fs.existsSync(configPath)) {
        console.log(chalk.yellow('! 未找到主题配置文件:', configPath));
        return {};
      }

      const configContent = fs.readFileSync(configPath, 'utf8');
      const config = yaml.load(configContent);
      
      console.log(chalk.green('✓ 成功读取主题配置文件'));
      return config || {};
    } catch (error) {
      console.error(chalk.red('❌ 读取主题配置文件失败:'), error);
      return {};
    }
  }

  // 清理旧的CSS文件
  cleanOldCssFiles(outputDir, skipClean = false) {
    if (skipClean) {
      Utils.logDebug(this.hexo, '跳过CSS文件清理（由外部控制）', 'TailwindCSS');
      return;
    }
    
    if (!fs.existsSync(outputDir)) return;
    
    const files = fs.readdirSync(outputDir);
    let cleanedCount = 0;
    
    files.forEach(file => {
      if (file.match(/^components\.styles\.[a-f0-9]{8}\.css$/)) {
        const filePath = path.join(outputDir, file);
        try {
          fs.unlinkSync(filePath);
          cleanedCount++;
          Utils.logDebug(this.hexo, `清理旧CSS文件: ${file}`, 'TailwindCSS');
        } catch (error) {
          Utils.logError(this.hexo, `清理文件失败 ${file}:`, error, 'TailwindCSS');
        }
      }
    });

    if (cleanedCount > 0) {
      Utils.logSuccess(this.hexo, `已清理 ${cleanedCount} 个旧CSS文件`, 'TailwindCSS');
    }
  }

  // 清理调试文件
  cleanupDebugFile(debugPath) {
    if (!debugPath || !fs.existsSync(debugPath)) {
      return;
    }

    try {
      fs.unlinkSync(debugPath);
      Utils.logDebug(this.hexo, '✓ 已清理调试文件', 'TailwindCSS');
    } catch (error) {
      Utils.logWarning(this.hexo, `清理调试文件失败: ${error.message}`, 'TailwindCSS');
    }
  }

  // 检测并验证 TailwindCSS 4.0 配置文件
  detectTailwindConfig() {
    const configPath = path.join(this.hexo.base_dir, 'tailwind.config.js');
    
    // 检查文件是否存在
    if (!Utils.fileExists(configPath)) {
      Utils.logDebug(this.hexo, '未找到 tailwind.config.js 文件', 'TailwindCSS');
      return { exists: false, config: null, path: configPath };
    }

    try {
      // 清除 require 缓存，确保获取最新配置
      delete require.cache[require.resolve(configPath)];
      const userConfig = require(configPath);
      
      // 验证配置是否适用于 TailwindCSS 4.0
      const isV4Compatible = this.validateTailwindV4Config(userConfig);
      
      if (isV4Compatible) {
        Utils.logSuccess(this.hexo, '✓ 检测到 TailwindCSS 4.0 兼容配置文件', 'TailwindCSS');
        return { exists: true, config: userConfig, path: configPath, compatible: true };
      } else {
        Utils.logWarning(this.hexo, '⚠ 检测到 tailwind.config.js 但不完全兼容 TailwindCSS 4.0', 'TailwindCSS');
        Utils.logDebug(this.hexo, '将使用默认配置以确保兼容性', 'TailwindCSS');
        return { exists: true, config: null, path: configPath, compatible: false };
      }
    } catch (error) {
      Utils.logError(this.hexo, `加载 tailwind.config.js 失败: ${error.message}`, 'TailwindCSS');
      Utils.logDebug(this.hexo, '将使用默认配置', 'TailwindCSS');
      return { exists: true, config: null, path: configPath, compatible: false };
    }
  }

  // 验证配置是否兼容 TailwindCSS 4.0
  validateTailwindV4Config(config) {
    if (!config || typeof config !== 'object') {
      return false;
    }

    // TailwindCSS 4.0 的一些特征检查
    const v4Features = {
      // 检查是否有 v3 特有的配置（这些在 v4 中不再需要或已更改）
      hasV3Content: config.content && (Array.isArray(config.content) || config.content.files),
      hasV3Plugins: config.plugins && Array.isArray(config.plugins) && config.plugins.length > 0,
      hasV3Theme: config.theme && typeof config.theme === 'object',
      
      // 检查是否有 v4 特有的配置
      hasV4Config: config.experimental || config.future || config.layer
    };

    // 如果没有任何 v3 特有的配置，认为是兼容的
    const hasV3OnlyFeatures = v4Features.hasV3Content || v4Features.hasV3Plugins;
    
    if (!hasV3OnlyFeatures) {
      Utils.logDebug(this.hexo, '配置文件不包含 v3 特有配置，兼容 TailwindCSS 4.0', 'TailwindCSS');
      return true;
    }

    // 如果有 v3 配置但也有 v4 特性，给出提示但仍然使用
    if (hasV3OnlyFeatures && v4Features.hasV4Config) {
      Utils.logWarning(this.hexo, '配置文件包含 v3 和 v4 混合配置，建议更新为纯 v4 配置', 'TailwindCSS');
      return true;
    }

    // 如果只有 v3 配置，建议更新
    if (hasV3OnlyFeatures) {
      Utils.logWarning(this.hexo, '配置文件主要为 TailwindCSS v3 格式，建议更新为 v4 格式', 'TailwindCSS');
      Utils.logDebug(this.hexo, '或者删除 tailwind.config.js 使用 CSS 文件本身的配置', 'TailwindCSS');
      return false;
    }

    return true;
  }

  // 获取Tailwind配置 - TailwindCSS 4.0 智能版
  getTailwindConfig() {
    const detection = this.detectTailwindConfig();
    
    if (!detection.exists) {
      Utils.logDebug(this.hexo, '🎯 使用 TailwindCSS 4.0 默认配置（推荐方式）', 'TailwindCSS');
      return null; // 返回 null 表示使用默认配置
    }

    if (detection.compatible && detection.config) {
      Utils.logSuccess(this.hexo, '🎯 使用用户自定义 TailwindCSS 4.0 配置', 'TailwindCSS');
      return detection.config;
    }

    // 配置文件存在但不兼容，使用默认配置
    Utils.logDebug(this.hexo, '🎯 使用 TailwindCSS 4.0 默认配置（配置文件不兼容）', 'TailwindCSS');
    return null;
  }

  // 扫描并加载组件样式文件
  scanComponentStyles() {
    const componentDir = path.join(this.hexo.theme_dir, 'layout', 'components');
    const pattern = path.join(componentDir, '**', '*.css');
    
    // 清空现有缓存
    const previousCacheSize = this.componentStyles.size;
    this.componentStyles.clear();
    
    if (previousCacheSize > 0) {
      Utils.logDebug(this.hexo, `清空了 ${previousCacheSize} 个缓存的组件样式`, 'TailwindCSS');
    }
    
    try {
      // 使用glob扫描所有组件CSS文件
      const cssFiles = glob.sync(pattern, { 
        windowsPathsNoEscape: true // Windows路径兼容性
      });
      
      if (cssFiles.length === 0) {
        Utils.logDebug(this.hexo, '未找到组件样式文件', 'TailwindCSS');
        return '';
      }
      
      let combinedStyles = '';
      const loadedComponents = [];
      
      cssFiles.forEach(filePath => {
        try {
          // 实时读取文件内容（不依赖缓存）
          const content = fs.readFileSync(filePath, 'utf8');
          const relativePath = path.relative(this.hexo.theme_dir, filePath);
          const componentName = this.getComponentNameFromPath(filePath);
          const fileStats = fs.statSync(filePath);
          
          Utils.logDebug(this.hexo, `重新读取组件样式: ${componentName} (${fileStats.size} bytes, 修改时间: ${fileStats.mtime.toISOString()})`, 'TailwindCSS');
          
          // 缓存组件样式
          this.componentStyles.set(filePath, {
            content: content,
            componentName: componentName,
            relativePath: relativePath,
            lastModified: fileStats.mtime
          });
          
          // 添加文件标识注释
          combinedStyles += `\n/* === 组件样式: ${componentName} (${relativePath}) === */\n`;
          combinedStyles += content;
          combinedStyles += '\n';
          
          loadedComponents.push(componentName);
          
        } catch (error) {
          Utils.logError(this.hexo, `读取组件样式文件失败 ${filePath}:`, error, 'TailwindCSS');
        }
      });
      
      if (loadedComponents.length > 0) {
        Utils.logSuccess(this.hexo, `重新扫描并加载了 ${loadedComponents.length} 个组件样式文件`, 'TailwindCSS');
        Utils.logDebug(this.hexo, `加载的组件: ${loadedComponents.join(', ')}`, 'TailwindCSS');
      }
      
      return combinedStyles;
      
    } catch (error) {
      Utils.logError(this.hexo, '扫描组件样式文件失败:', error, 'TailwindCSS');
      return '';
    }
  }

  // 从文件路径提取组件名称
  getComponentNameFromPath(filePath) {
    const componentsDir = path.join(this.hexo.theme_dir, 'layout', 'components');
    const relativePath = path.relative(componentsDir, filePath);
    const parts = relativePath.split(path.sep);
    
    // 返回组件文件夹名称
    return parts[0] || path.basename(filePath, '.css');
  }

  // 检查组件样式文件是否有变化
  hasComponentStylesChanged() {
    const componentDir = path.join(this.hexo.theme_dir, 'layout', 'components');
    const pattern = path.join(componentDir, '**', '*.css');
    
    try {
      const currentFiles = glob.sync(pattern, { 
        windowsPathsNoEscape: true 
      });
      
      // 检查文件数量是否变化
      if (currentFiles.length !== this.componentStyles.size) {
        return true;
      }
      
      // 检查每个文件的修改时间
      for (const filePath of currentFiles) {
        const cached = this.componentStyles.get(filePath);
        if (!cached) {
          return true;
        }
        
        const currentMtime = fs.statSync(filePath).mtime;
        if (currentMtime.getTime() !== cached.lastModified.getTime()) {
          return true;
        }
      }
      
      return false;
    } catch (error) {
      Utils.logDebug(this.hexo, '检查组件样式文件变化时出错，假定已变化', 'TailwindCSS');
      return true;
    }
  }

  // 生成主CSS文件 - TailwindCSS 4.0 版本（增强版）
  generateMainCSS() {
    // 读取主 tailwind.css 文件
    const tailwindCssPath = path.join(this.hexo.theme_dir, 'layout', 'tailwind.css');
    
    if (!Utils.fileExists(tailwindCssPath)) {
      Utils.logError(this.hexo, '未找到 tailwind.css 文件:', tailwindCssPath, 'TailwindCSS');
      throw new Error(`TailwindCSS 4.0 主样式文件不存在: ${tailwindCssPath}`);
    }
    
    try {
      const mainCSS = fs.readFileSync(tailwindCssPath, 'utf8');
      Utils.logSuccess(this.hexo, '成功读取 TailwindCSS 4.0 主样式文件', 'TailwindCSS');
      Utils.logDebug(this.hexo, `样式文件路径: ${tailwindCssPath}`, 'TailwindCSS');
      
      // 扫描并加载组件样式文件
      const componentStyles = this.scanComponentStyles();
      
      // 合并样式文件，确保组件样式优先级最高
      let combinedCSS = mainCSS;
      
      if (componentStyles.trim()) {
        // 在主CSS文件末尾添加组件样式，确保优先级
        combinedCSS += '\n\n/* =============================== */';
        combinedCSS += '\n/* === 动态加载的组件样式文件 === */';
        combinedCSS += '\n/* === 优先级最高，覆盖默认样式 === */';
        combinedCSS += '\n/* =============================== */';
        combinedCSS += componentStyles;
      }
      
      return combinedCSS;
      
    } catch (error) {
      Utils.logError(this.hexo, '生成主CSS文件失败:', error, 'TailwindCSS');
      throw new Error(`无法生成 TailwindCSS 4.0 主样式文件: ${error.message}`);
    }
  }

  // 获取组件样式文件统计信息
  getComponentStylesInfo() {
    const info = {
      totalCount: this.componentStyles.size,
      components: [],
      totalSize: 0
    };

    this.componentStyles.forEach((value, key) => {
      info.components.push({
        name: value.componentName,
        path: value.relativePath,
        size: value.content.length,
        lastModified: value.lastModified
      });
      info.totalSize += value.content.length;
    });

    return info;
  }

  // 监控组件样式文件变化
  watchComponentStyles(callback) {
    const componentDir = path.join(this.hexo.theme_dir, 'layout', 'components');
    const pattern = path.join(componentDir, '**', '*.css');
    
    if (!fs.existsSync(componentDir)) {
      Utils.logWarning(this.hexo, '组件目录不存在，跳过监控', 'TailwindCSS');
      return null;
    }

    const watcher = chokidar.watch(pattern, {
      ignored: /node_modules/,
      persistent: true,
      ignoreInitial: true
    });

    watcher.on('add', (filePath) => {
      Utils.logDebug(this.hexo, `新增组件样式文件: ${path.relative(this.hexo.theme_dir, filePath)}`, 'TailwindCSS');
      if (callback) callback('add', filePath);
    });

    watcher.on('change', (filePath) => {
      Utils.logDebug(this.hexo, `组件样式文件已修改: ${path.relative(this.hexo.theme_dir, filePath)}`, 'TailwindCSS');
      if (callback) callback('change', filePath);
    });

    watcher.on('unlink', (filePath) => {
      Utils.logDebug(this.hexo, `删除组件样式文件: ${path.relative(this.hexo.theme_dir, filePath)}`, 'TailwindCSS');
      this.componentStyles.delete(filePath);
      if (callback) callback('unlink', filePath);
    });

    return watcher;
  }

  // 验证组件样式文件格式
  validateComponentStyle(filePath) {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      
      // 检查是否包含 @layer components
      const hasLayerComponents = content.includes('@layer components');
      
      if (!hasLayerComponents) {
        Utils.logWarning(this.hexo, 
          `组件样式文件 ${path.relative(this.hexo.theme_dir, filePath)} 不包含 @layer components，可能导致优先级问题`, 
          'TailwindCSS');
        return { valid: false, reason: 'missing @layer components' };
      }
      
      return { valid: true, content };
    } catch (error) {
      Utils.logError(this.hexo, `验证组件样式文件失败 ${filePath}:`, error, 'TailwindCSS');
      return { valid: false, reason: error.message };
    }
  }

  // 重新加载单个组件样式
  reloadComponentStyle(filePath) {
    try {
      const validation = this.validateComponentStyle(filePath);
      if (!validation.valid) {
        return false;
      }

      const componentName = this.getComponentNameFromPath(filePath);
      const relativePath = path.relative(this.hexo.theme_dir, filePath);
      
      this.componentStyles.set(filePath, {
        content: validation.content,
        componentName: componentName,
        relativePath: relativePath,
        lastModified: fs.statSync(filePath).mtime
      });
      
      Utils.logSuccess(this.hexo, `重新加载组件样式: ${componentName}`, 'TailwindCSS');
      return true;
    } catch (error) {
      Utils.logError(this.hexo, `重新加载组件样式失败:`, error, 'TailwindCSS');
      return false;
    }
  }

  // 编译CSS - TailwindCSS 4.0 版本（增强版）
  async compile(options = {}) {
    const { skipClean = false, keepDebugFile = false, forceRecompile = false } = options;
    
    Utils.logDebug(this.hexo, `TailwindCompiler.compile调用，参数: ${JSON.stringify(options)}，forceRecompile: ${forceRecompile}`, 'TailwindCSS');
    
    if (this.isProcessing) {
      Utils.logWarning(this.hexo, '编译进行中，跳过本次编译请求', 'TailwindCSS');
      return null;
    }
    
    let debugPath = null; // 声明调试文件路径变量
    
    try {
      this.isProcessing = true;
      const compileMode = forceRecompile ? '强制重新编译' : '增量编译';
      console.log(chalk.cyan(`\n🎨 开始编译和压缩 TailwindCSS 4.0 样式... (${compileMode})\n`));

      // 确保输出目录存在
      const outputDir = path.join(this.hexo.theme_dir, 'source/css');
      Utils.ensureDirectoryExists(outputDir);

      // 记录编译前的组件缓存状态
      const preCacheSize = this.componentStyles.size;
      Utils.logInfo(this.hexo, `🔍 编译前组件缓存状态: ${preCacheSize} 个组件`, 'TailwindCSS');
      
      // 强制重新编译时清空组件样式缓存
      if (forceRecompile) {
        Utils.logInfo(this.hexo, '🧹 强制重新编译：清空组件样式缓存', 'TailwindCSS');
        this.componentStyles.clear();
        Utils.logInfo(this.hexo, `🧹 缓存清空完成，之前有 ${preCacheSize} 个组件`, 'TailwindCSS');
      } else if (this.componentStyles.size > 0) {
        // 非强制编译时检查是否需要重新编译
        const hasChanged = this.hasComponentStylesChanged();
        if (!hasChanged) {
          Utils.logDebug(this.hexo, '组件样式文件未变化，跳过编译', 'TailwindCSS');
          return Array.from(this.currentCssFiles)[0] || null;
        } else {
          Utils.logDebug(this.hexo, '检测到组件样式文件变化，开始重新编译', 'TailwindCSS');
        }
      }

      // 检查现有CSS文件状态
      const existingCssFiles = this.currentCssFiles;
      if (existingCssFiles.size > 0) {
        Utils.logDebug(this.hexo, `编译前存在的CSS文件: ${Array.from(existingCssFiles).map(f => path.basename(f)).join(', ')}`, 'TailwindCSS');
      }

      // 清理旧的CSS文件
      this.cleanOldCssFiles(outputDir, skipClean);

      // 读取主CSS文件（包含组件样式）
      Utils.logDebug(this.hexo, '开始生成主CSS文件（包含组件样式）', 'TailwindCSS');
      const mainCSS = this.generateMainCSS();
      
      // 额外调试：检查组件样式部分
      const componentStylesInfo = this.getComponentStylesInfo();
      Utils.logInfo(this.hexo, `🔍 CSS生成后组件缓存状态: ${componentStylesInfo.totalCount} 个组件`, 'TailwindCSS');
      if (componentStylesInfo.totalCount > 0) {
        componentStylesInfo.components.forEach(comp => {
          Utils.logInfo(this.hexo, `  📄 ${comp.name}: ${comp.size} bytes, 修改时间: ${comp.lastModified.toISOString()}`, 'TailwindCSS');
        });
      } else {
        Utils.logWarning(this.hexo, '⚠️  没有加载任何组件样式文件！', 'TailwindCSS');
      }
      
      // 获取用户配置（如果有且兼容）
      const userConfig = this.getTailwindConfig();
      
      // 强制重新编译时添加随机注释以绕过TailwindCSS内部缓存
      let processCSS = mainCSS;
      if (forceRecompile) {
        const timestamp = Date.now();
        const randomSuffix = Math.random().toString(36).substring(2, 8);
        const uniqueId = `${timestamp}_${randomSuffix}`;
        const randomComment = `\n/* Force recompile: ${uniqueId} */\n`;
        processCSS = randomComment + mainCSS;
        Utils.logInfo(this.hexo, `🔄 添加强制重新编译标记: ${uniqueId}`, 'TailwindCSS');
        Utils.logInfo(this.hexo, `📊 主CSS长度: ${mainCSS.length}, 处理后长度: ${processCSS.length}`, 'TailwindCSS');
      } else {
        Utils.logInfo(this.hexo, `📊 非强制编译，主CSS长度: ${mainCSS.length}`, 'TailwindCSS');
      }
      
      // 计算处理用CSS的哈希值用于调试（基于最终要处理的内容）
      const processCSSHash = Utils.getFileHash(processCSS).substring(0, 8);
      Utils.logInfo(this.hexo, `处理用CSS内容哈希: ${processCSSHash} (长度: ${processCSS.length} 字符)`, 'TailwindCSS');
      
      // 保存原始CSS用于调试（临时文件）
      debugPath = path.join(outputDir, 'debug-original.css');
      Utils.writeFileContent(debugPath, processCSS);
      Utils.logDebug(this.hexo, '📋 创建临时调试文件', 'TailwindCSS');
      
      // 创建PostCSS处理器 - 根据配置情况智能调用，包含 minify
      const cssnanoOptions = {
        preset: ['default', {
          discardComments: { removeAll: true },
          normalizeWhitespace: true,
          colormin: true,
          minifyFontValues: true,
          minifyParams: true,
          minifySelectors: true
        }]
      };
      
      // 强制重新编译时创建新的处理器实例避免插件缓存
      let tailwindPlugin, processor;
      if (forceRecompile) {
        Utils.logInfo(this.hexo, '🔄 强制重新编译：创建新的PostCSS处理器实例', 'TailwindCSS');
        tailwindPlugin = userConfig ? tailwindcss(userConfig) : tailwindcss();
        processor = postcss([tailwindPlugin, cssnano(cssnanoOptions)]);
      } else {
        processor = userConfig 
          ? postcss([tailwindcss(userConfig), cssnano(cssnanoOptions)])  // 有配置时传递配置
          : postcss([tailwindcss(), cssnano(cssnanoOptions)]);           // 无配置时使用默认
      }

      // 开始编译进度条
      this.progressBar.start(100, 0, { unit: '%' });

      // 编译CSS
      const tailwindCssPath = path.join(this.hexo.theme_dir, 'layout', 'tailwind.css');
      
      // 强制重新编译时使用唯一的虚拟路径避免PostCSS缓存
      let fromPath = tailwindCssPath;
      if (forceRecompile) {
        const timestamp = Date.now();
        const randomSuffix = Math.random().toString(36).substring(2, 8);
        fromPath = `${tailwindCssPath}?v=${timestamp}_${randomSuffix}`;
        Utils.logInfo(this.hexo, `🔄 使用唯一PostCSS源路径避免缓存: ${fromPath}`, 'TailwindCSS');
      }
      
      const result = await processor.process(processCSS, {
        from: fromPath,
        to: undefined // 让 PostCSS 自动处理
      });

      // 更新进度条
      this.progressBar.update(100);
      this.progressBar.stop();

      // 生成输出文件名
      const hash = Utils.getFileHash(result.css).substring(0, 8);
      const outputFilename = `components.styles.${hash}.css`;
      
      Utils.logDebug(this.hexo, `编译后CSS内容哈希: ${hash} (处理前: ${processCSSHash})`, 'TailwindCSS');
      
      // 强制重新编译时验证编译结果是否真的发生了变化
      if (forceRecompile) {
        const resultCSSHash = Utils.getFileHash(result.css).substring(0, 8);
        Utils.logInfo(this.hexo, `🔍 强制重新编译验证:`, 'TailwindCSS');
        Utils.logInfo(this.hexo, `  📊 原始CSS哈希: ${processCSSHash}`, 'TailwindCSS');
        Utils.logInfo(this.hexo, `  🎯 编译后哈希: ${resultCSSHash}`, 'TailwindCSS');
        Utils.logInfo(this.hexo, `  📏 原始长度: ${processCSS.length}, 编译后长度: ${result.css.length}`, 'TailwindCSS');
        
        if (resultCSSHash === '019e87d5') {
          Utils.logError(this.hexo, '❌ 严重问题：强制重新编译仍产生固定哈希值！', 'TailwindCSS');
          Utils.logError(this.hexo, '❌ 这表明PostCSS处理器可能存在深层缓存问题', 'TailwindCSS');
          Utils.logError(this.hexo, `❌ 使用的from路径: ${fromPath}`, 'TailwindCSS');
          Utils.logError(this.hexo, `❌ 处理器实例: ${forceRecompile ? '新创建' : '复用'}`, 'TailwindCSS');
        } else {
          Utils.logSuccess(this.hexo, '✅ 强制重新编译成功：哈希值已改变', 'TailwindCSS');
        }
      }
      
      // 写入编译后的CSS
      const outputPath = path.join(outputDir, outputFilename);
      Utils.writeFileContent(outputPath, result.css);

      // 更新当前CSS文件集合（不包含调试文件）
      this.currentCssFiles.clear();
      this.currentCssFiles.add(outputPath);

      const originalSize = processCSS.length;
      const compressedSize = result.css.length;
      const compressionRatio = originalSize > compressedSize ? 
        ((originalSize - compressedSize) / originalSize * 100).toFixed(2) : 
        '0.00';
      
      console.log(chalk.green('\n✓ TailwindCSS 4.0 编译完成（已压缩）:'), 
        chalk.cyan(outputFilename),
        chalk.gray(`(${Utils.formatFileSize(compressedSize)}, 压缩: ${compressionRatio}%)`));
      
      Utils.logInfo(this.hexo, `编译完成，输出文件: ${outputFilename}，哈希: ${hash}`, 'TailwindCSS');
      
      // 特别检查是否出现固定哈希值
      if (hash === '019e87d5') {
        Utils.logWarning(this.hexo, '⚠️ 检测到固定哈希值 019e87d5，可能存在缓存问题！', 'TailwindCSS');
        Utils.logWarning(this.hexo, `⚠️ 强制重新编译标志: ${forceRecompile}, 组件数量: ${this.componentStyles.size}`, 'TailwindCSS');
      }
      
      // 记录编译类型，便于问题追踪
      const compileType = forceRecompile ? '强制重新编译' : '增量编译';
      Utils.logDebug(this.hexo, `编译类型: ${compileType}，缓存状态: ${this.componentStyles.size} 个组件`, 'TailwindCSS');

      // 临时保留调试文件用于问题诊断
      if (!keepDebugFile && forceRecompile) {
        // 强制重新编译时保留调试文件以便检查内容
        Utils.logInfo(this.hexo, '📋 强制重新编译时保留调试文件用于问题诊断', 'TailwindCSS');
        Utils.logInfo(this.hexo, `📁 调试文件路径: ${debugPath}`, 'TailwindCSS');
        this.currentCssFiles.add(debugPath);
      } else if (!keepDebugFile) {
        this.cleanupDebugFile(debugPath);
      } else {
        Utils.logDebug(this.hexo, '📋 保留调试文件（用户要求）', 'TailwindCSS');
        this.currentCssFiles.add(debugPath);
      }

      return outputPath;
    } catch (error) {
      console.error(chalk.red('\n❌ TailwindCSS 4.0 编译错误:'), error);
      
      // 即使编译失败也要清理调试文件
      if (debugPath && !keepDebugFile) {
        this.cleanupDebugFile(debugPath);
      }
      
      return null;
    } finally {
      this.isProcessing = false;
      this.progressBar.stop();
    }
  }
}

module.exports = TailwindCompiler; 