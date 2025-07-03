'use strict';

const terser = require('terser');
const chalk = require('chalk');

/**
 * JavaScript 加密、压缩和混淆处理器
 */
class JsEncryption {
  constructor(hexo) {
    this.hexo = hexo;
  }

  /**
   * 根据配置获取是否启用压缩
   */
  shouldMinify() {
    return this.hexo.config.theme_builder && 
           this.hexo.config.theme_builder.javascript && 
           this.hexo.config.theme_builder.javascript.minify === true;
  }

  /**
   * 根据配置获取是否启用混淆保护
   */
  shouldProtect() {
    return this.hexo.config.theme_builder && 
           this.hexo.config.theme_builder.javascript && 
           this.hexo.config.theme_builder.javascript.protected === true;
  }

  /**
   * 处理 JavaScript 代码
   * @param {string} code - 原始 JS 代码
   * @param {string} filename - 文件名，用于日志
   * @returns {Promise<string>} - 处理后的代码
   */
  async process(code, filename) {
    const shouldMinify = this.shouldMinify();
    const shouldProtect = this.shouldProtect();
    
    // 如果两者都不启用，直接返回原始代码
    if (!shouldMinify && !shouldProtect) {
      return code;
    }
    
    try {
      // 准备 terser 选项
      const options = {
        compress: shouldMinify ? {
          dead_code: true,
          drop_console: false,
          drop_debugger: true,
          keep_classnames: false,
          keep_fargs: true,
          keep_infinity: true
        } : false,
        mangle: shouldProtect ? {
          toplevel: true,
          reserved: [],
          properties: {
            regex: /^_/  // 保护以下划线开头的属性
          }
        } : false,
        format: {
          comments: shouldProtect ? false : 'some'
        },
        sourceMap: false,
        // 防止调试的选择性选项
        ...(shouldProtect ? {
          ecma: 2020,
          safari10: true,
          ie8: false,
          keep_classnames: false,
          keep_fnames: false,
          module: true
        } : {})
      };

      // 添加防调试代码
      let processedCode = code;
      if (shouldProtect) {
        // 添加简单的反调试代码
        const antiDebugCode = `
          ;(function(){
            const d = function() {
              const s = new Error().stack;
              if (s && (s.includes('debugger') || s.includes('devtools'))) {
                window.location.reload();
              }
            };
            setInterval(d, 1000);
            window.addEventListener('devtoolschange', function(e) {
              if (e.detail.open) { window.location.reload(); }
            });
          })();
        `;
        processedCode = antiDebugCode + processedCode;
      }

      // 使用 terser 处理代码
      const result = await terser.minify(processedCode, options);
      
      if (result.error) {
        console.error(chalk.red(`[JS加密] 处理 ${filename} 时出错:`), result.error);
        return code; // 出错时返回原始代码
      }

      // 日志输出
      const originalSize = Buffer.byteLength(code, 'utf8');
      const processedSize = Buffer.byteLength(result.code, 'utf8');
      const reduction = ((originalSize - processedSize) / originalSize * 100).toFixed(1);
      
      let logMessage = `[JS加密] ${filename}: `;
      if (shouldMinify) logMessage += '已压缩 ';
      if (shouldProtect) logMessage += '已混淆保护 ';
      logMessage += `(${this.formatSize(originalSize)} → ${this.formatSize(processedSize)}, 减少 ${reduction}%)`;
      
      console.log(chalk.blue(logMessage));
      
      return result.code;
    } catch (error) {
      console.error(chalk.red(`[JS加密] 处理 ${filename} 时发生异常:`), error);
      return code; // 出错时返回原始代码
    }
  }

  /**
   * 格式化文件大小
   */
  formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    else if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    else return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }
}

module.exports = JsEncryption; 