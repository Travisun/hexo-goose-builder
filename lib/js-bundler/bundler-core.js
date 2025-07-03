 'use strict';

const path = require('path');
const fs = require('fs');
const chalk = require('chalk');
const Utils = require('./utils');
const ESMProcessor = require('./esm-processor');

class BundlerCore {
  constructor(config) {
    this.config = config;
    this.esmProcessor = new ESMProcessor(config);
    this.isProcessing = false;
  }

  findJsFiles(componentsDir) {
    const results = [];
    const items = fs.readdirSync(componentsDir);

    for (const item of items) {
      const fullPath = path.join(componentsDir, item);
      const stat = fs.statSync(fullPath);

      if (stat.isDirectory()) {
        if (item === 'js') {
          // 找到js目录，添加所有js文件
          const jsFiles = fs.readdirSync(fullPath)
            .filter(file => file.endsWith('.js'))
            .map(file => path.join(fullPath, file));
          results.push(...jsFiles);
        } else {
          // 递归搜索其他目录
          const subResults = this.findJsFiles(fullPath);
          if (Array.isArray(subResults)) {
            results.push(...subResults);
          }
        }
      }
    }

    return results;
  }

  async processFiles(jsFiles, componentsDir) {
    try {
      Utils.logInfo(this.config.hexo, '开始分析组件文件...');
      
      jsFiles.forEach(file => {
        const relativePath = path.relative(componentsDir, file);
        const componentName = relativePath.split(path.sep)[0];
        Utils.logDebug(this.config.hexo, `组件: ${componentName} (${relativePath})`);
      });

      Utils.logDebug(this.config.hexo, `总计: ${jsFiles.length} 个组件文件`);

      // 使用 Rollup 处理文件
      const bundleResult = await this.esmProcessor.bundleESM(jsFiles, componentsDir);
      
      return bundleResult;
    } catch (error) {
      Utils.logError(this.config.hexo, '处理文件时发生错误:', error);
      throw error;
    }
  }

  async bundle() {
    if (this.isProcessing) return null;
    
    try {
      this.isProcessing = true;

      Utils.logInfo(this.config.hexo, '开始打包组件JS文件...');
      Utils.logDebug(this.config.hexo, `JS加密状态: ${this.config.enableEncryption ? '已启用' : '已禁用'}`);
      Utils.logDebug(this.config.hexo, `CSS输出路径: ${this.config.cssFullPath}`);

      const componentsDir = this.config.getComponentsDir();
      const jsFiles = this.findJsFiles(componentsDir);

      if (jsFiles.length === 0) {
        Utils.logWarning(this.config.hexo, '没有找到组件JS文件');
        return null;
      }

      // 按组件分类显示找到的文件
      const filesByComponent = {};
      jsFiles.forEach(file => {
        const relativePath = path.relative(componentsDir, file);
        const componentName = relativePath.split(path.sep)[0];
        if (!filesByComponent[componentName]) {
          filesByComponent[componentName] = [];
        }
        filesByComponent[componentName].push(relativePath);
      });

      Utils.logSuccess(this.config.hexo, `找到 ${jsFiles.length} 个JS文件，分布在 ${Object.keys(filesByComponent).length} 个组件中`);
      
      Object.entries(filesByComponent).forEach(([component, files]) => {
        Utils.logDebug(this.config.hexo, `${component}:`);
        files.forEach(file => {
          Utils.logDebug(this.config.hexo, `  └─ ${file}`);
        });
      });

      const jsDir = this.config.getJsDir();
      Utils.ensureDirectoryExists(jsDir);
      
      // 确保 CSS 输出目录存在
      const cssDir = this.config.getCssDir();
      Utils.ensureDirectoryExists(cssDir);
      console.log(chalk.gray(`✓ 创建CSS目录: ${path.relative(this.config.hexo.theme_dir, cssDir)}`));

      // 清理旧文件
      console.log(chalk.blue('\n🧹 清理旧文件...'));
      
      // 清理 JS 目录
      const oldJsFiles = fs.readdirSync(jsDir);
      oldJsFiles.forEach(file => {
        if (file.startsWith('components.') || file.startsWith('chunk-')) {
          const filePath = path.join(jsDir, file);
          try {
            fs.unlinkSync(filePath);
            Utils.logInfo(`  ├─ 删除旧JS文件: ${chalk.cyan(file)}`);
          } catch (error) {
            Utils.logError(`  ├─ 删除JS文件失败: ${chalk.red(file)}`, error);
          }
        }
      });

      // 清理 CSS 目录
      if (fs.existsSync(this.config.cssDir)) {
        const oldCssFiles = fs.readdirSync(this.config.cssDir);
        oldCssFiles.forEach(file => {
          // 匹配 component.bundle.[hash].css 格式
          if (file.startsWith('component.bundle.') && file.endsWith('.css')) {
            const filePath = path.join(this.config.cssDir, file);
            try {
              fs.unlinkSync(filePath);
              Utils.logInfo(`  ├─ 删除旧CSS文件: ${chalk.cyan(file)}`);
            } catch (error) {
              Utils.logError(`  ├─ 删除CSS文件失败: ${chalk.red(file)}`, error);
            }
          }
        });
      }

      // 使用 Rollup 处理文件
      const bundleResult = await this.processFiles(jsFiles, componentsDir);
      
      // 检查文件是否生成
      const generatedJsFiles = fs.readdirSync(jsDir).filter(file => file.endsWith('.js'));
      
      // 移动 CSS 文件到正确的目录并重命名
      const cssFiles = fs.readdirSync(jsDir).filter(file => file.endsWith('.css'));
      if (cssFiles.length > 0) {
        cssFiles.forEach(cssFile => {
          const sourcePath = path.join(jsDir, cssFile);
          // 生成新的文件名：component.bundle.[hash].css
          const hash = Math.random().toString(36).substring(2, 8);
          const newFileName = `component.bundle.${hash}.css`;
          const targetPath = path.join(this.config.cssDir, newFileName);
          try {
            // 确保目标目录存在
            Utils.ensureDirectoryExists(this.config.cssDir);
            // 移动并重命名文件
            fs.renameSync(sourcePath, targetPath);
            Utils.logSuccess('✓ 移动并重命名CSS文件:', 
              chalk.cyan(`${path.relative(this.config.hexo.theme_dir, targetPath)}`));
          } catch (error) {
            Utils.logError(`无法移动CSS文件 ${cssFile}:`, error);
          }
        });
      }
      
      // 重新统计文件
      const generatedCssFiles = fs.readdirSync(this.config.cssDir).filter(file => file.endsWith('.css'));
      
      console.log(chalk.blue('\n📝 生成文件统计:'));
      console.log(chalk.gray(`  ├─ JS文件: ${chalk.cyan(generatedJsFiles.length)} 个`));
      console.log(chalk.gray(`  └─ CSS文件: ${chalk.cyan(generatedCssFiles.length)} 个\n`));
      
      console.log(chalk.green('\n✨ 组件JS打包完成!\n'));

      // 如果生成了 CSS 文件，输出相关信息
      if (fs.existsSync(this.config.cssFullPath)) {
        const cssSize = fs.statSync(this.config.cssFullPath).size;
        Utils.logSuccess('✓ 生成组件CSS文件:', 
          chalk.cyan(path.relative(this.config.hexo.theme_dir, this.config.cssFullPath)),
          chalk.gray(`(${Utils.formatSize(cssSize)})`));
      }

      return {
        chunks: bundleResult.map(chunk => chunk.fileName),
        css: this.config.cssFullPath
      };
    } catch (error) {
      console.error(chalk.red('\n❌ 打包组件JS时发生错误:'), error);
      return null;
    } finally {
      this.isProcessing = false;
    }
  }
}

module.exports = BundlerCore;