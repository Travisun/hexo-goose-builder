 'use strict';

const path = require('path');

class BundlerConfig {
  constructor(hexo) {
    this.hexo = hexo;
    
    // 从配置中读取加密设置
    const config = hexo.config.theme_builder || {};
    this.enableEncryption = config.js_encryption === true;
    
    // CSS 输出配置
    const cssFileName = 'components.styles.' + Math.random().toString(36).substring(2, 8) + '.css';
    this.cssFileName = cssFileName;
    this.cssDir = path.join(this.hexo.theme_dir, 'source/css');
    this.cssFullPath = path.join(this.cssDir, cssFileName);
    this.cssOutputPath = cssFileName; // Rollup 使用的文件名
    
    // Terser配置
    this.terserOptions = {
      compress: {
        dead_code: true,
        drop_console: true,
        drop_debugger: true,
        keep_classnames: false,
        keep_fargs: false,
        keep_fnames: false,
        keep_infinity: true,
        passes: 3,
        unsafe_math: true,
        unsafe_methods: true,
        unsafe_proto: true,
        unsafe_regexp: true,
        unsafe_undefined: true
      },
      mangle: {
        eval: true,
        keep_classnames: false,
        keep_fnames: false,
        toplevel: true,
        properties: {
          regex: /^_/  // 只混淆以下划线开头的属性名
        }
      },
      format: {
        ascii_only: true,
        beautify: false,
        comments: false
      },
      sourceMap: false,
      ecma: 2020,
      nameCache: null
    };

    // 混淆器配置
    this.obfuscatorOptions = {
      compact: true,
      controlFlowFlattening: true,
      controlFlowFlatteningThreshold: 0.75,
      deadCodeInjection: true,
      deadCodeInjectionThreshold: 0.4,
      debugProtection: true,
      debugProtectionInterval: 2000,
      disableConsoleOutput: true,
      identifierNamesGenerator: 'hexadecimal',
      log: false,
      numbersToExpressions: true,
      renameGlobals: false,
      rotateStringArray: true,
      selfDefending: true,
      shuffleStringArray: true,
      splitStrings: true,
      splitStringsChunkLength: 10,
      stringArray: true,
      stringArrayEncoding: ['base64'],
      stringArrayThreshold: 0.75,
      transformObjectKeys: true,
      unicodeEscapeSequence: false
    };

    // Rollup 配置
    this.rollupConfig = {
      plugins: [
        require('./rollup-plugins').getPlugins(this)
      ]
    };
  }

  getJsDir() {
    return path.join(this.hexo.theme_dir, 'source/js');
  }

  getComponentsDir() {
    return path.join(this.hexo.theme_dir, 'layout');
  }

  getCssDir() {
    return this.cssDir;
  }
}

module.exports = BundlerConfig;