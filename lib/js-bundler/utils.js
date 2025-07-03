 'use strict';

const fs = require('fs');
const path = require('path');
const chalk = require('chalk');
const cliProgress = require('cli-progress');

class BundlerUtils {
  static ensureDirectoryExists(dir) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  static getFileHash(content) {
    const crypto = require('crypto');
    return crypto.createHash('md5').update(content).digest('hex');
  }

  static createProgressBar() {
    return new cliProgress.MultiBar({
      clearOnComplete: false,
      hideCursor: true,
      format: '{task} |' + chalk.cyan('{bar}') + '| {percentage}% || {value}/{total} {unit} ' + chalk.gray('{component}'),
    }, cliProgress.Presets.shades_classic);
  }

  static isDebugEnabled(hexo) {
    const config = hexo.config;
    return config && config.theme_builder && config.theme_builder.debug === true;
  }

  static logInfo(hexo, message, component = 'JS Bundler') {
    // 总是显示重要信息
    console.log(chalk.blue(`[${component}] ${message}`));
  }

  static logSuccess(hexo, message, component = 'JS Bundler') {
    // 总是显示成功信息
    console.log(chalk.green(`[${component}] ✓ ${message}`));
  }

  static logWarning(hexo, message, component = 'JS Bundler') {
    // 总是显示警告信息
    console.warn(chalk.yellow(`[${component}] ⚠ ${message}`));
  }

  static logError(hexo, message, error = null, component = 'JS Bundler') {
    // 总是显示错误信息
    console.error(chalk.red(`[${component}] ❌ ${message}`), error || '');
  }

  static logDebug(hexo, message, component = 'JS Bundler') {
    // 只在调试模式下显示详细信息
    if (BundlerUtils.isDebugEnabled(hexo)) {
      console.log(chalk.gray(`[${component}] ${message}`));
    }
  }

  static formatSize(size) {
    return `${(size / 1024).toFixed(2)}KB`;
  }

  static formatCompressionRatio(originalSize, compressedSize) {
    return ((originalSize - compressedSize) / originalSize * 100).toFixed(2);
  }
}

module.exports = BundlerUtils;