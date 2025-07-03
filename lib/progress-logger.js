/**
 * 进度条和滚动日志管理器
 * 提供单行进度条显示，支持实时状态更新
 */
class ProgressLogger {
  constructor(taskName = 'Progress') {
    this.taskName = taskName;
    this.total = 0;
    this.current = 0;
    this.lastUpdateTime = 0;
    this.updateInterval = 100; // 限制更新频率，避免闪烁
    
    // 输出控制
    this.isActive = false; // 进度条是否正在活跃显示
    this.pendingLogs = []; // 暂存被拦截的日志
    
    // 保存原始的 console 方法和 process.stdout.write
    this.originalConsole = {
      log: console.log,
      warn: console.warn,
      error: console.error,
      info: console.info
    };
    this.originalStdoutWrite = process.stdout.write.bind(process.stdout);
  }

  /**
   * 设置总数
   * @param {number} total 总数
   */
  setTotal(total) {
    this.total = Math.max(0, total || 0);
    this.current = 0;
    this.isActive = true;
    this.pendingLogs = [];
    
    // 开始拦截所有输出
    this.interceptOutput();
    
    // 显示初始进度条
    this.render();
  }

  /**
   * 拦截所有输出
   */
  interceptOutput() {
    const self = this;
    
    // 创建 console 拦截函数
    const createConsoleInterceptor = (originalMethod, logLevel) => {
      return function(...args) {
        if (self.isActive) {
          // 如果进度条活跃，暂存日志
          self.pendingLogs.push({
            type: 'console',
            level: logLevel,
            args: args,
            timestamp: Date.now()
          });
        } else {
          // 如果进度条不活跃，直接输出
          originalMethod.apply(console, args);
        }
      };
    };
    
    // 替换 console 方法
    console.log = createConsoleInterceptor(this.originalConsole.log, 'log');
    console.warn = createConsoleInterceptor(this.originalConsole.warn, 'warn');
    console.error = createConsoleInterceptor(this.originalConsole.error, 'error');
    console.info = createConsoleInterceptor(this.originalConsole.info, 'info');
    
    // 拦截 process.stdout.write
    process.stdout.write = function(string, encoding, fd) {
      if (self.isActive && string !== '\r' && !string.includes('[' + self.taskName + ']')) {
        // 暂存非进度条的直接输出
        self.pendingLogs.push({
          type: 'stdout',
          data: string,
          encoding: encoding,
          fd: fd,
          timestamp: Date.now()
        });
        return true;
      } else {
        // 允许进度条自己的输出和回车符
        return self.originalStdoutWrite(string, encoding, fd);
      }
    };
  }

  /**
   * 恢复所有输出
   */
  restoreOutput() {
    console.log = this.originalConsole.log;
    console.warn = this.originalConsole.warn;
    console.error = this.originalConsole.error;
    console.info = this.originalConsole.info;
    process.stdout.write = this.originalStdoutWrite;
  }

  /**
   * 输出被暂存的日志
   */
  flushPendingLogs() {
    if (this.pendingLogs.length > 0) {
      // 先换行
      this.originalStdoutWrite('\n');
      
      // 输出所有暂存的内容
      this.pendingLogs.forEach(entry => {
        if (entry.type === 'console') {
          const method = this.originalConsole[entry.level] || this.originalConsole.log;
          method.apply(console, entry.args);
        } else if (entry.type === 'stdout') {
          this.originalStdoutWrite(entry.data, entry.encoding, entry.fd);
        }
      });
      
      this.pendingLogs = [];
    }
  }

  /**
   * 更新进度
   * @param {number} current 当前进度
   * @param {string} message 状态消息（已不使用，保留兼容性）
   */
  updateProgress(current, message = '') {
    this.current = Math.max(0, Math.min(this.total, current));
    
    // 限制更新频率，避免闪烁
    const now = Date.now();
    if (now - this.lastUpdateTime < this.updateInterval && this.current < this.total) {
      return;
    }
    this.lastUpdateTime = now;
    
    this.render();
  }

  /**
   * 渲染进度条
   */
  render() {
    if (!this.isActive) return;
    
    // 计算进度百分比
    const percentage = this.total > 0 ? Math.round((this.current / this.total) * 100) : 0;
    
    // 创建进度条
    const barLength = 30;
    const filledLength = Math.max(0, Math.min(barLength, Math.round((percentage / 100) * barLength)));
    const emptyLength = Math.max(0, barLength - filledLength);
    const progressBar = '█'.repeat(filledLength) + '░'.repeat(emptyLength);
    
    // 只显示基础进度文本
    const fullText = `[${this.taskName}] [${progressBar}] ${percentage}% (${this.current}/${this.total})`;
    
    // 使用简单的回车覆盖方式
    this.originalStdoutWrite('\r' + fullText);
  }

  /**
   * 完成进度显示
   * @param {number} successCount 成功数量
   * @param {number} failCount 失败数量
   * @param {number} totalCount 总数量
   * @param {string} taskName 任务名称，默认使用构造函数中的任务名称
   */
  complete(successCount, failCount, totalCount, taskName = null) {
    const finalTaskName = taskName || this.taskName;
    
    // 停止拦截
    this.isActive = false;
    this.restoreOutput();
    
    // 清除当前行
    this.originalStdoutWrite('\r\x1b[2K');

    // 显示最终结果
    const successRate = totalCount > 0 ? Math.round((successCount / totalCount) * 100) : 0;
    const statusIcon = failCount > 0 ? '⚠️' : '✅';
    
    console.log(`${statusIcon} [${finalTaskName}] 处理完成: ${successCount}/${totalCount} 成功 (${successRate}%)`);
    if (failCount > 0) {
      console.log(`❌ [${finalTaskName}] ${failCount} 个项目处理失败`);
    }
    
    // 输出被暂存的日志
    this.flushPendingLogs();
    
    console.log(''); // 空行分隔
  }

  /**
   * 强制刷新显示（忽略更新频率限制）
   */
  forceUpdate() {
    this.lastUpdateTime = 0;
    this.render();
  }

  /**
   * 清除进度条显示
   */
  clear() {
    this.isActive = false;
    this.restoreOutput();
    
    // 清除当前行
    this.originalStdoutWrite('\r\x1b[2K');
    
    // 输出被暂存的日志
    this.flushPendingLogs();
  }
}

module.exports = ProgressLogger; 