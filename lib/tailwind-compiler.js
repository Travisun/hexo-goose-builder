'use strict';

const fs = require('fs');
const path = require('path');
const postcss = require('postcss');
const tailwindcss = require('@tailwindcss/postcss');
const Utils = require('./utils');
const chalk = require('chalk');
const cliProgress = require('cli-progress');
const chokidar = require('chokidar');
const yaml = require('js-yaml');

class TailwindCompiler {
  constructor(hexo) {
    this.hexo = hexo;
    this.isProcessing = false;
    this.currentCssFiles = new Set();

    // 获取主题配置
    this.themeName = this.getThemeStyleName();
    
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

  // 获取主题风格名称
  getThemeStyleName() {
    const config = this.readThemeConfig();
    const styleName = config.style_name || 'fresh';
    Utils.logSuccess(this.hexo, `当前主题风格: ${styleName}`, 'TailwindCSS');
    return styleName;
  }

  // 获取主题配置
  getThemeConfig() {
    Utils.logDebug(this.hexo, '主题配置信息:', 'TailwindCSS');
    Utils.logDebug(this.hexo, 'hexo.config.theme_config: ' + JSON.stringify(this.hexo.config.theme_config), 'TailwindCSS');
    Utils.logDebug(this.hexo, 'hexo.theme.config: ' + JSON.stringify(this.hexo.theme.config), 'TailwindCSS');
    
    return {
      ...(this.hexo.theme.config || {}),
      ...(this.hexo.config.theme_config || {})
    };
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

  // 获取默认的内容扫描规则
  getDefaultContentRules() {
    let theme_name = this.hexo.config.theme || 'default';
    return [
      './themes/'+theme_name+'/layout/**/*.{js,css,ejs}',
    ];
  }

  // 获取Tailwind配置
  getTailwindConfig() {
    const configPath = path.join(this.hexo.base_dir, 'tailwind.config.js');
    
    // 获取默认内容扫描规则
    const defaultContentRules = this.getDefaultContentRules();
    
    let userConfig = {};
    
    // 尝试加载用户配置
    if (Utils.fileExists(configPath)) {
      try {
        // 清除 require 缓存，确保获取最新配置
        delete require.cache[require.resolve(configPath)];
        userConfig = require(configPath);
        Utils.logDebug(this.hexo, '成功加载用户 Tailwind 配置', 'TailwindCSS');
      } catch (error) {
        Utils.logWarning(this.hexo, `加载 Tailwind 配置失败: ${error.message}`, 'TailwindCSS');
        Utils.logDebug(this.hexo, '将使用默认配置', 'TailwindCSS');
      }
    } else {
      Utils.logWarning(this.hexo, '未找到 tailwind.config.js 文件，将使用默认配置', 'TailwindCSS');
    }
    
    // 合并内容扫描规则
    let mergedContentRules = [...defaultContentRules];
    
    if (userConfig.content) {
      if (Array.isArray(userConfig.content)) {
        // 用户配置是数组，直接合并
        mergedContentRules = [...new Set([...defaultContentRules, ...userConfig.content])];
        Utils.logDebug(this.hexo, `合并内容扫描规则: 默认 ${defaultContentRules.length} 条 + 用户 ${userConfig.content.length} 条`, 'TailwindCSS');
      } else if (typeof userConfig.content === 'object' && userConfig.content.files) {
        // 用户配置是对象格式 (v3.3+)
        mergedContentRules = [...new Set([...defaultContentRules, ...userConfig.content.files])];
        Utils.logDebug(this.hexo, `合并内容扫描规则: 默认 ${defaultContentRules.length} 条 + 用户 ${userConfig.content.files.length} 条`, 'TailwindCSS');
      }
    } else {
      Utils.logDebug(this.hexo, `使用默认内容扫描规则: ${defaultContentRules.length} 条`, 'TailwindCSS');
    }
    
    // 构建最终配置
    const finalConfig = {
      // 默认配置
      content: mergedContentRules,
      theme: {
        extend: {}
      },
      plugins: [],
      
      // 覆盖用户配置
      ...userConfig,
      
      // 确保 content 字段使用合并后的规则
      content: mergedContentRules
    };
    
    // 输出调试信息
    Utils.logDebug(this.hexo, `最终内容扫描规则数量: ${mergedContentRules.length}`, 'TailwindCSS');
    Utils.logDebug(this.hexo, '内容扫描规则:', 'TailwindCSS');
    mergedContentRules.forEach((rule, index) => {
      Utils.logDebug(this.hexo, `  ${index + 1}. ${rule}`, 'TailwindCSS');
    });
    
    return finalConfig;
  }

  // 获取主题样式文件
  getThemeStyleFile() {
    const themeStylePath = path.join(this.hexo.theme_dir, 'styles', this.themeName, 'style.css');
    if (Utils.fileExists(themeStylePath)) {
      Utils.logDebug(this.hexo, `找到主题样式文件: ${themeStylePath}`, 'TailwindCSS');
      return themeStylePath;
    }
    Utils.logDebug(this.hexo, `未找到主题样式文件: ${themeStylePath}`, 'TailwindCSS');
    return null;
  }

  // 收集所有样式文件
  collectAllStyles() {
    const styles = {
      base: [], // 基础样式
      components: [], // 组件样式
      theme: null // 主题样式
    };

    // 1. 收集组件样式
    const componentsDir = path.join(this.hexo.theme_dir, 'layout/components');
    
    function searchDirectory(dir, collection) {
      if (!fs.existsSync(dir)) return;
      
      const items = fs.readdirSync(dir);
      for (const item of items) {
        const fullPath = path.join(dir, item);
        const stat = fs.statSync(fullPath);
        
        if (stat.isDirectory()) {
          if (item === 'css') {
            const files = fs.readdirSync(fullPath)
              .filter(file => file.endsWith('.css'))
              .map(file => path.join(fullPath, file));
            collection.push(...files);
          } else {
            searchDirectory(fullPath, collection);
          }
        } else if (item.endsWith('.css')) {
          collection.push(fullPath);
        }
      }
    }
    
    // 收集组件目录下的样式
    searchDirectory(componentsDir, styles.components);
    
    // 2. 收集布局基础样式
    const layoutStylesDir = path.join(this.hexo.theme_dir, 'layout/styles');
    if (fs.existsSync(layoutStylesDir)) {
      searchDirectory(layoutStylesDir, styles.base);
    }

    // 3. 获取主题风格样式
    // 主layout目录主题文件
    const mainThemePath = path.join(this.hexo.theme_dir, 'layout', 'theme.css');
    // 对于某些主题可能支持 子主题文件，子主题文件具有高优先级
    const themeStylePath = path.join(this.hexo.theme_dir, 'layout/styles', this.themeName, 'theme.css');
    if (Utils.fileExists(themeStylePath)) {
      styles.theme = themeStylePath;
      Utils.logDebug(this.hexo, `找到主题样式文件: ${themeStylePath}`, 'TailwindCSS');
    }else if(Utils.fileExists(mainThemePath)) {
      styles.theme = mainThemePath;
      Utils.logDebug(this.hexo, `找到主题样式文件: ${mainThemePath}`, 'TailwindCSS');
    } else {
      Utils.logDebug(this.hexo, `未找到主题样式文件: ${themeStylePath}`, 'TailwindCSS');
    }

    return styles;
  }

  // 生成主CSS文件
  generateMainCSS() {
    let mainCSS = `/* Hexo Theme Styles */\n\n`;
    
    // 导入 Tailwind CSS 4
    mainCSS += `@import "tailwindcss";\n\n`;
    
    // 主题配置 - 使用 Tailwind CSS 4 的 @theme 指令
    mainCSS += `@theme {\n`;
    mainCSS += `  /* 基础变量 */\n`;
    mainCSS += `  --spacing: 0.25rem;\n`;
    mainCSS += `  --radius-sm: 0.125rem;\n`;
    mainCSS += `  --radius-md: 0.375rem;\n`;
    mainCSS += `  --radius-lg: 0.5rem;\n\n`;
    
    // 颜色配置
    mainCSS += `  /* 颜色系统 */\n`;
    mainCSS += `  --color-primary: oklch(49.12% 0.3096 275.75);\n`;
    mainCSS += `  --color-secondary: oklch(65.84% 0.2285 155.91);\n`;
    mainCSS += `  --color-accent: oklch(85.35% 0.1852 89.12);\n\n`;
    
    // 字体配置
    mainCSS += `  /* 字体系统 */\n`;
    mainCSS += `  --font-sans: ui-sans-serif, system-ui, sans-serif;\n`;
    mainCSS += `  --font-serif: ui-serif, Georgia, serif;\n`;
    mainCSS += `  --font-mono: ui-monospace, monospace;\n\n`;
    
    // 断点配置
    mainCSS += `  /* 响应式断点 */\n`;
    mainCSS += `  --breakpoint-sm: 640px;\n`;
    mainCSS += `  --breakpoint-md: 768px;\n`;
    mainCSS += `  --breakpoint-lg: 1024px;\n`;
    mainCSS += `  --breakpoint-xl: 1280px;\n`;
    mainCSS += `  --breakpoint-2xl: 1536px;\n`;
    mainCSS += `}\n\n`;

    // 添加主题样式源文件扫描
    mainCSS += `@source "${path.join(this.hexo.theme_dir, 'layout/**/*.{ejs,js,css}').replace(/\\/g, '/')}";\n\n`;
    
    return mainCSS;
  }

  // 编译CSS
  async compile(options = {}) {
    const { skipClean = false } = options;
    
    if (this.isProcessing) {
      Utils.logWarning(this.hexo, '编译进行中，跳过本次编译请求', 'TailwindCSS');
      return null;
    }
    
    try {
      this.isProcessing = true;
      console.log(chalk.cyan('\n🎨 开始编译主题样式...\n'));

      // 确保输出目录存在
      const outputDir = path.join(this.hexo.theme_dir, 'source/css');
      Utils.ensureDirectoryExists(outputDir);

      // 清理旧的CSS文件
      this.cleanOldCssFiles(outputDir, skipClean);

      // 生成主CSS文件
      const mainCSS = this.generateMainCSS();
      
      // 保存原始CSS用于调试
      const debugPath = path.join(outputDir, 'debug-original.css');
      Utils.writeFileContent(debugPath, mainCSS);
      
      // 创建PostCSS处理器 - 使用 @tailwindcss/postcss
      const processor = postcss([
        tailwindcss()
      ]);

      // 开始编译进度条
      this.progressBar.start(100, 0, { unit: '%' });

      // 编译CSS
      const result = await processor.process(mainCSS, {
        from: path.join(this.hexo.theme_dir, 'source/css/input.css'),
        to: path.join(this.hexo.theme_dir, 'source/css/output.css')
      });

      // 更新进度条
      this.progressBar.update(100);
      this.progressBar.stop();

      // 生成输出文件名
      const hash = Utils.getFileHash(result.css).substring(0, 8);
      const outputFilename = `components.styles.${hash}.css`;
      
      // 写入编译后的CSS
      const outputPath = path.join(outputDir, outputFilename);
      Utils.writeFileContent(outputPath, result.css);

      // 更新当前CSS文件集合
      this.currentCssFiles.clear();
      this.currentCssFiles.add(outputPath);
      this.currentCssFiles.add(debugPath);

      const originalSize = mainCSS.length;
      const compressedSize = result.css.length;
      const compressionRatio = ((originalSize - compressedSize) / originalSize * 100).toFixed(2);
      
      console.log(chalk.green('\n✓ CSS编译完成:'), 
        chalk.cyan(outputFilename),
        chalk.gray(`(${Utils.formatFileSize(compressedSize)}, 压缩率: ${compressionRatio}%)`));

      return outputPath;
    } catch (error) {
      console.error(chalk.red('\n❌ CSS编译错误:'), error);
      return null;
    } finally {
      this.isProcessing = false;
      this.progressBar.stop();
    }
  }
}

module.exports = TailwindCompiler; 