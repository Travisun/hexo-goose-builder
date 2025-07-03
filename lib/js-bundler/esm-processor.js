'use strict';

const path = require('path');
const rollup = require('rollup');
const chalk = require('chalk');
const Utils = require('./utils');
const JsEncryption = require('./js-encryption');

class ESMProcessor {
  constructor(config) {
    this.config = config;
    this.jsEncryption = new JsEncryption(config.hexo);
  }

  async bundleESM(files, componentsDir) {
    try {
      Utils.logInfo(this.config.hexo, '开始处理 ESM 文件...', 'ESM Processor');
      
      // 创建入口点映射
      const entryPoints = {};
      
      files.forEach(file => {
        const relativePath = path.relative(componentsDir, file);
        const componentName = relativePath.split(path.sep)[0];
        
        // 使用相对路径作为入口点名称，这样可以保持目录结构
        const entryName = relativePath.replace(/\.js$/, '');
        entryPoints[entryName] = file;
      });

      Utils.logDebug(this.config.hexo, '入口文件:', 'ESM Processor');
      Object.entries(entryPoints).forEach(([name, file]) => {
        Utils.logDebug(this.config.hexo, `  └─ ${name}`, 'ESM Processor');
      });

      const jsDir = this.config.getJsDir();
      const cssDir = this.config.getCssDir();
      
      Utils.ensureDirectoryExists(jsDir);
      Utils.ensureDirectoryExists(cssDir);

      // Rollup 配置
      const bundle = await rollup.rollup({
        input: entryPoints,
        plugins: this.config.rollupConfig.plugins,
        external: (id) => {
          // 将 CDN 链接标记为外部依赖
          if (id.startsWith('https://') || id.startsWith('http://')) {
            return true;
          }
          // 其他外部依赖处理
          return false;
        },
        onwarn: (warning, warn) => {
          // 忽略循环依赖警告
          if (warning.code === 'CIRCULAR_DEPENDENCY') return;
          // 忽略空包警告
          if (warning.code === 'EMPTY_BUNDLE') return;
          // 忽略无法解析的 CDN 导入警告
          if (warning.code === 'UNRESOLVED_IMPORT' && 
              warning.source && 
              (warning.source.startsWith('https://') || warning.source.startsWith('http://'))) {
            Utils.logDebug(this.config.hexo, `外部 CDN 依赖: ${warning.source}`, 'ESM Processor');
            return;
          }
          warn(warning);
        }
      });

      Utils.logDebug(this.config.hexo, '生成输出...', 'ESM Processor');

      // 输出配置
      Utils.logDebug(this.config.hexo, '正在写入文件...', 'ESM Processor');
      const { output } = await bundle.write({
        dir: jsDir,
        format: 'es',
        entryFileNames: 'components.[hash].bundle.js',
        chunkFileNames: (chunkInfo) => {
          // 根据分块名称生成文件名
          if (chunkInfo.name === 'vendor-framework') {
            return 'components.vendor.framework.[hash].js';
          }
          if (chunkInfo.name === 'vendor-markdown') {
            return 'components.vendor.markdown.[hash].js';
          }
          if (chunkInfo.name === 'vendor') {
            return 'components.vendor.[hash].js';
          }
          if (chunkInfo.name === 'shared') {
            return 'components.shared.[hash].js';
          }
          // 其他模块代码
          return 'components.[hash].chunk.js';
        },
        manualChunks(id) {
          // 如果是 node_modules 中的模块，统一放入 vendor
          if (id.includes('node_modules')) {
            // 根据依赖类型进行分组
            if (id.includes('vue')) {
              return 'vendor-framework';
            }
            if (id.includes('katex') || id.includes('marked')) {
              return 'vendor-markdown';
            }
            return 'vendor';
          }
          
          // 工具函数和共享代码
          if (id.includes('/utils/') || id.includes('/shared/') || id.includes('/helpers/')) {
            return 'shared';
          }
          
          // 其他模块保持独立
          return null;
        }
      });

      // 处理JS文件加密和压缩
      const processedOutput = [];
      for (const chunk of output) {
        if (chunk.type === 'chunk' && chunk.code) {
          // 对JS代码进行加密处理
          const processedCode = await this.jsEncryption.process(chunk.code, chunk.fileName);
          
          // 更新chunk中的代码
          chunk.code = processedCode;
          
          // 写入处理后的文件
          const filePath = path.join(jsDir, chunk.fileName);
          require('fs').writeFileSync(filePath, processedCode);
        }
        processedOutput.push(chunk);
      }

      // 创建manifest
      const manifest = {};
      processedOutput.forEach(chunk => {
        if (chunk.isEntry) {
          const componentName = path.basename(chunk.facadeModuleId).split(path.sep)[0];
          manifest[componentName] = {
            file: chunk.fileName,
            imports: chunk.imports,
            dynamicImports: chunk.dynamicImports
          };
        }
      });

      // 保存manifest
      const manifestPath = path.join(jsDir, 'components.manifest.json');
      require('fs').writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

      // 处理CSS输出
      processedOutput.forEach(chunk => {
        if (chunk.type === 'asset' && chunk.fileName.endsWith('.css')) {
          // CSS文件已经由postcss插件写入到正确的位置
          const relativePath = path.relative(this.config.hexo.theme_dir, this.config.cssFullPath)
            .split(path.sep)
            .join('/');
          Utils.logSuccess(this.config.hexo, `CSS文件已生成: ${relativePath} (${Utils.formatSize(chunk.source.length)})`, 'ESM Processor');
        }
      });

      await bundle.close();

      // 输出文件信息
      const jsFiles = processedOutput.filter(chunk => chunk.type === 'chunk');
      const cssFiles = processedOutput.filter(chunk => chunk.type === 'asset' && chunk.fileName.endsWith('.css'));
      
      Utils.logDebug(this.config.hexo, '文件生成统计:', 'ESM Processor');
      jsFiles.forEach(chunk => {
        const size = chunk.code ? Utils.formatSize(chunk.code.length) : '0B';
        if (chunk.isEntry) {
          Utils.logDebug(this.config.hexo, `  ├─ 入口文件: ${chunk.fileName} (${size})`, 'ESM Processor');
        } else {
          Utils.logDebug(this.config.hexo, `  ├─ 分块文件: ${chunk.fileName} (${size})`, 'ESM Processor');
        }
      });
      
      cssFiles.forEach(chunk => {
        const size = chunk.source ? Utils.formatSize(chunk.source.length) : '0B';
        Utils.logDebug(this.config.hexo, `  ├─ CSS文件: ${chunk.fileName} (${size})`, 'ESM Processor');
      });
      
      Utils.logSuccess(this.config.hexo, `ESM模块处理完成，输出 ${jsFiles.length} 个JS文件，${cssFiles.length} 个CSS文件`, 'ESM Processor');
      
      return processedOutput;
    } catch (error) {
      Utils.logError(this.config.hexo, 'Rollup 打包错误:', error, 'ESM Processor');
      return [];
    }
  }
}

module.exports = ESMProcessor;