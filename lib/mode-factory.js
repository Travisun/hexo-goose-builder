'use strict';

const ServerModeHandler = require('./server-mode-handler');
const StaticModeHandler = require('./static-mode-handler');
const NullModeHandler = require('./null-mode-handler');
const chalk = require('chalk');

/**
 * 模式工厂
 * 根据执行模式创建对应的处理器
 */
class ModeFactory {
  /**
   * 创建模式处理器
   * @param {string} mode - 执行模式 (server, generate, deploy, etc.)
   * @param {Object} themeBuilder - 主题构建器实例
   * @returns {Object} 对应的模式处理器
   */
  static createHandler(mode, themeBuilder) {
    // 检查是否为支持的模式
    if (!ModeFactory.isSupportedMode(mode)) {
      // console.log(chalk.gray(`[Mode Factory] ${mode}模式不受支持，插件将保持静默`));
      return new NullModeHandler(themeBuilder);
    }
    
    //console.log(chalk.blue(`[Mode Factory] 创建${mode}模式处理器...`));
    
    switch (mode) {
      case 'server':
        return new ServerModeHandler(themeBuilder);
      
      case 'generate':
      case 'deploy':
        return new StaticModeHandler(themeBuilder);
      
      default:
        // 这里理论上不会到达，因为上面已经检查过支持的模式
        // console.warn(chalk.yellow(`[Mode Factory] ⚠ 意外的模式: ${mode}，使用空处理器`));
        return new NullModeHandler(themeBuilder);
    }
  }

  /**
   * 检查模式是否支持
   * @param {string} mode - 执行模式
   * @returns {boolean} 是否支持该模式
   */
  static isSupportedMode(mode) {
    const supportedModes = ['server', 'generate', 'deploy'];
    return supportedModes.includes(mode);
  }

  /**
   * 获取支持的模式列表
   * @returns {Array} 支持的模式列表
   */
  static getSupportedModes() {
    return ['server', 'generate', 'deploy'];
  }

  /**
   * 获取模式描述
   * @param {string} mode - 执行模式
   * @returns {string} 模式描述
   */
  static getModeDescription(mode) {
    const descriptions = {
      'server': '开发服务器模式 - 支持文件监听和热重载',
      'generate': '静态生成模式 - 生成静态网站文件',
      'deploy': '部署模式 - 生成并部署到远程服务器',
    };
    
    return descriptions[mode] || `${mode}模式`;
  }

  /**
   * 检查模式特性
   * @param {string} mode - 执行模式
   * @returns {Object} 模式特性
   */
  static getModeFeatures(mode) {
    const features = {
      'server': {
        watchFiles: true,
        asyncCompile: true,
        hotReload: true,
        forceCompile: false,
        validateAssets: false
      },
      'generate': {
        watchFiles: false,
        asyncCompile: false,
        hotReload: false,
        forceCompile: true,
        validateAssets: true
      },
      'deploy': {
        watchFiles: false,
        asyncCompile: false,
        hotReload: false,
        forceCompile: true,
        validateAssets: true,
        clearCache: true,
        strictValidation: true
      }
    };
    
    return features[mode] || features['generate']; // 默认使用generate模式特性
  }
}

module.exports = ModeFactory; 