'use strict';

const fs = require('fs');
const path = require('path');
const postcss = require('postcss');
const tailwindcss = require('tailwindcss');
const autoprefixer = require('autoprefixer');
const cssnano = require('cssnano');
const Utils = require('./utils');
const chalk = require('chalk');
const cliProgress = require('cli-progress');
const chokidar = require('chokidar');
const yaml = require('js-yaml');

class TailwindCompiler {
  constructor(hexo) {
    this.hexo = hexo;
    this.isProcessing = false;
    this.currentCssFiles = new Set(); // 跟踪当前生成的CSS文件

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
    // 输出调试信息
    Utils.logDebug(this.hexo, '主题配置信息:', 'TailwindCSS');
    Utils.logDebug(this.hexo, 'hexo.config.theme_config: ' + JSON.stringify(this.hexo.config.theme_config), 'TailwindCSS');
    Utils.logDebug(this.hexo, 'hexo.theme.config: ' + JSON.stringify(this.hexo.theme.config), 'TailwindCSS');
    
    // 返回合并后的配置
    return {
      ...(this.hexo.theme.config || {}),
      ...(this.hexo.config.theme_config || {})
    };
  }

  // 清理旧的CSS文件
  cleanOldCssFiles(outputDir) {
    if (!fs.existsSync(outputDir)) return;
    
    const files = fs.readdirSync(outputDir);
    let cleanedCount = 0;
    
    files.forEach(file => {
      // 匹配组件样式文件名模式：components.styles.[hash].css
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

  // 获取Tailwind配置
  getTailwindConfig() {
    const configPath = path.join(this.hexo.base_dir, 'tailwind.config.js');
    if (!Utils.fileExists(configPath)) {
      throw new Error('找不到 tailwind.config.js 文件');
    }
    return require(configPath);
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
    const themeStylePath = path.join(this.hexo.theme_dir, 'layout/styles', this.themeName, 'style.css');
    if (Utils.fileExists(themeStylePath)) {
      styles.theme = themeStylePath;
      Utils.logDebug(this.hexo, `找到主题样式文件: ${themeStylePath}`, 'TailwindCSS');
      Utils.logSuccess(this.hexo, `找到主题风格文件: ${themeStylePath}`, 'TailwindCSS');
    } else {
      Utils.logDebug(this.hexo, `未找到主题样式文件: ${themeStylePath}`, 'TailwindCSS');
      Utils.logWarning(this.hexo, `未找到主题风格文件: ${themeStylePath}`, 'TailwindCSS');
    }

    return styles;
  }

  // 生成主CSS文件
  generateMainCSS() {
    const styles = this.collectAllStyles();
    
    let mainCSS = `/* Hexo Theme Styles */\n\n`;
    
    // 1. Tailwind 指令
    mainCSS += `@tailwind base;\n`;
    mainCSS += `@tailwind components;\n`;
    mainCSS += `@tailwind utilities;\n\n`;
    
    // 2. 基础样式
    if (styles.base.length > 0) {
      mainCSS += `/* Base Styles */\n`;
      styles.base.forEach(file => {
        const content = Utils.readFileContent(file);
        const relativePath = path.relative(this.hexo.theme_dir, file);
        mainCSS += `/* ${relativePath} */\n${content}\n\n`;
      });
      Utils.logSuccess(this.hexo, `加载基础样式: ${styles.base.length} 个文件`, 'TailwindCSS');
    }
    
    // 3. 组件样式
    if (styles.components.length > 0) {
      mainCSS += `/* Component Styles */\n`;
      mainCSS += `@layer components {\n`; // 开始组件层
      styles.components.forEach(file => {
        const content = Utils.readFileContent(file);
        const relativePath = path.relative(this.hexo.theme_dir, file);
        mainCSS += `/* ${relativePath} */\n${content}\n\n`;
      });
      mainCSS += `}\n\n`; // 结束组件层
      Utils.logSuccess(this.hexo, `加载组件样式: ${styles.components.length} 个文件`, 'TailwindCSS');
    }
    
    // 4. 主题风格样式（最高优先级）
    if (styles.theme) {
      mainCSS += `/* Theme Style Override */\n`;
      const themeContent = Utils.readFileContent(styles.theme);
      
      // 检查主题样式内容是否已经包含在 @layer components 中
      if (!themeContent.includes('@layer components')) {
        mainCSS += `@layer components {\n`;
      }
      
      mainCSS += `/* styles/${this.themeName}/style.css */\n`;
      mainCSS += themeContent;
      
      if (!themeContent.includes('@layer components')) {
        mainCSS += `\n}\n`; // 只在需要时关闭 layer
      }
      
      mainCSS += `\n`;
      Utils.logSuccess(this.hexo, `加载主题风格: ${this.themeName}`, 'TailwindCSS');
      
      // 添加调试信息
      mainCSS += `\n/* Debug Information */\n`;
      mainCSS += `/* Theme Style Path: ${styles.theme} */\n`;
      mainCSS += `/* Theme Style Content Length: ${themeContent.length} */\n\n`;
    }
    
    return mainCSS;
  }

  // 编译CSS
  async compile() {
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
      this.cleanOldCssFiles(outputDir);

      // 生成主CSS文件
      const mainCSS = this.generateMainCSS();
      
      // 保存原始CSS用于调试
      const debugPath = path.join(outputDir, 'debug-original.css');
      Utils.writeFileContent(debugPath, mainCSS);
      console.log(chalk.yellow('调试文件已保存:', debugPath));
      
      // 获取Tailwind配置
      const tailwindConfig = this.getTailwindConfig();
      console.log(chalk.green('✓ 加载Tailwind配置文件'));

      // 创建PostCSS处理器
      const processor = postcss([
        tailwindcss({
          ...tailwindConfig,
          important: true // 使所有生成的样式具有更高优先级
        }),
        autoprefixer(),
        cssnano({
          preset: ['default', {
            discardComments: {
              removeAll: false, // 保留注释以便调试
            }
          }]
        })
      ]);

      // 开始编译进度条
      this.progressBar.start(100, 0, { unit: '%' });

      // 编译CSS
      const result = await processor.process(mainCSS, {
        from: undefined,
        to: undefined
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