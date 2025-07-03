'use strict';

/**
 * 空模式处理器
 * 用于不支持的命令，不执行任何操作
 */
class NullModeHandler {
  constructor(themeBuilder) {
    this.themeBuilder = themeBuilder;
    this.hexo = themeBuilder.hexo;
    this.currentMode = themeBuilder.currentMode;
  }

  /**
   * 初始化 - 不执行任何操作
   */
  async initialize() {
    // 静默，不执行任何操作
  }

  /**
   * 注册事件处理器 - 不注册任何事件
   */
  registerEvents() {
    // 静默，不注册任何事件
  }

  /**
   * 处理资源标签获取 - 不执行任何操作
   */
  handleGetAssetTags() {
    // 静默，不执行任何操作
  }

  /**
   * 清理资源 - 不执行任何操作
   */
  cleanup() {
    // 静默，不执行任何操作
  }
}

module.exports = NullModeHandler; 