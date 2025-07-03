'use strict';

const chalk = require('chalk');
const path = require('path');
const fs = require('fs');

class Banner {
  constructor() {
    this.version = this.getVersion();
    this.author = 'Travis Tang';
    this.title = '🦢 Hexo Goose Builder';
  }

  /**
   * 获取插件版本号
   * 优先从package.json读取，如果失败则使用默认值
   */
  getVersion() {
    try {
      const packagePath = path.join(__dirname, '..', 'package.json');
      if (fs.existsSync(packagePath)) {
        const packageContent = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
        return packageContent.version || '1.0.0';
      }
    } catch (error) {
      // 如果读取失败，返回默认版本
    }
    return '1.0.0';
  }

  /**
   * 根据执行模式获取模式描述文本
   * @param {string} mode - 执行模式
   * @returns {string} - 模式描述文本
   */
  getModeText(mode) {
    const modeMap = {
      'deploy': '部署模式',
      'generate': '生成模式', 
      'server': '开发模式',
      's': '开发模式',
      'g': '生成模式',
      'd': '部署模式'
    };
    
    return modeMap[mode] || `${mode}模式`;
  }

  /**
   * 显示欢迎banner
   * @param {string} mode - 当前执行模式
   * @param {Object} options - 可选参数
   * @param {boolean} options.showModeOnly - 是否只显示模式信息
   * @param {string} options.customMessage - 自定义消息
   */
  show(mode, options = {}) {
    const { showModeOnly = false, customMessage } = options;
    const modeText = this.getModeText(mode);
    
    if (showModeOnly) {
      console.log(chalk.blue(`[Theme Builder] 当前模式: ${modeText}`));
      return;
    }

    const message = customMessage || `正在构建您的主题组件... (${modeText})`;
    
    console.log(chalk.cyan(`
──────────────────────────────────────────────────
                                                  
    ${this.title.padEnd(36)}     
    Version: ${this.version.padEnd(31)}     
    Author: ${this.author.padEnd(32)}                                                       
    ${message.padEnd(36)}     
                                                  
──────────────────────────────────────────────────
`));
  }

  /**
   * 显示完成banner
   * @param {string} mode - 当前执行模式
   * @param {string} action - 完成的动作，如'编译'、'部署'等
   */
  showComplete(mode, action = '构建') {
    const modeText = this.getModeText(mode);
    console.log(chalk.green(`
──────────────────────────────────────────────────
                                                  
     ✓ ${action}完成! (${modeText})                   
                                                  
──────────────────────────────────────────────────
`));
  }

  /**
   * 显示错误banner
   * @param {string} mode - 当前执行模式
   * @param {string} error - 错误信息
   */
  showError(mode, error) {
    const modeText = this.getModeText(mode);
    console.log(chalk.red(`
──────────────────────────────────────────────────
                                                  
     ❌ 构建失败! (${modeText})                      
     ${error.substring(0, 36).padEnd(36)}     
                                                 
──────────────────────────────────────────────────
`));
  }

  /**
   * 显示简洁的状态信息
   * @param {string} mode - 当前执行模式
   * @param {string} status - 状态信息
   * @param {string} type - 消息类型: 'info', 'success', 'warning', 'error'
   */
  showStatus(mode, status, type = 'info') {
    const modeText = this.getModeText(mode);
    const colorMap = {
      'info': chalk.blue,
      'success': chalk.green,
      'warning': chalk.yellow,
      'error': chalk.red
    };
    
    const color = colorMap[type] || chalk.blue;
    const icon = type === 'success' ? '✓' : 
                 type === 'warning' ? '⚠' : 
                 type === 'error' ? '❌' : 'ℹ';
    
    console.log(color(`[Theme Builder] ${icon} ${status} (${modeText})`));
  }
}

module.exports = Banner; 