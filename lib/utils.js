'use strict';

const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const chalk = require('chalk');

class Utils {
  // 确保目录存在
  static ensureDirectoryExists(dir) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  // 计算文件内容的哈希值
  static getFileHash(content) {
    return crypto.createHash('md5').update(content).digest('hex');
  }

  // 格式化文件大小
  static formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  }

  // 检查文件是否存在
  static fileExists(filePath) {
    try {
      fs.accessSync(filePath, fs.constants.F_OK);
      return true;
    } catch (err) {
      return false;
    }
  }

  // 读取文件内容
  static readFileContent(filePath) {
    try {
      return fs.readFileSync(filePath, 'utf8');
    } catch (err) {
      throw new Error(`无法读取文件 ${filePath}: ${err.message}`);
    }
  }

  // 写入文件内容
  static writeFileContent(filePath, content) {
    try {
      Utils.ensureDirectoryExists(path.dirname(filePath));
      fs.writeFileSync(filePath, content, 'utf8');
    } catch (err) {
      throw new Error(`无法写入文件 ${filePath}: ${err.message}`);
    }
  }

  // 删除文件
  static deleteFile(filePath) {
    try {
      if (this.fileExists(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch (err) {
      throw new Error(`无法删除文件 ${filePath}: ${err.message}`);
    }
  }

  // 获取文件扩展名
  static getFileExtension(filePath) {
    return filePath.split('.').pop().toLowerCase();
  }

  // 检查是否启用调试模式
  static isDebugEnabled(hexo) {
    const config = hexo.config;
    return config && config.theme_builder && config.theme_builder.debug === true;
  }

  // 统一的日志输出方法
  static logInfo(hexo, message, component = 'Theme Builder') {
    // 总是显示重要信息
    console.log(chalk.blue(`[${component}] ${message}`));
  }

  static logSuccess(hexo, message, component = 'Theme Builder') {
    // 总是显示成功信息
    console.log(chalk.green(`[${component}] ✓ ${message}`));
  }

  static logError(hexo, message, error = null, component = 'Theme Builder') {
    // 总是显示错误信息
    console.error(chalk.red(`[${component}] ❌ ${message}`), error || '');
  }

  static logWarning(hexo, message, component = 'Theme Builder') {
    // 总是显示警告信息
    console.warn(chalk.yellow(`[${component}] ⚠ ${message}`));
  }

  static logDebug(hexo, message, component = 'Theme Builder') {
    // 只在调试模式下显示详细信息
    if (Utils.isDebugEnabled(hexo)) {
      console.log(chalk.gray(`[${component}] ${message}`));
    }
  }
}

module.exports = Utils; 