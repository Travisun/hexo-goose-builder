# Banner 模块文档

Banner 模块是一个专门用于处理主题构建器信息展示的独立模块，提供了统一的 banner 和状态信息展示功能。

## 功能特性

- 🎨 美观的 ASCII 艺术 banner 展示
- 🔄 自动识别不同的执行模式（server、generate、deploy等）
- 📦 自动从 package.json 读取版本信息
- 🎯 多种展示模式：完整 banner、简洁模式、状态信息
- 🌈 彩色输出支持（基于 chalk）
- ⚡ 轻量级设计，无外部依赖冲突

## 基本用法

### 初始化

```javascript
const Banner = require('./lib/banner');
const banner = new Banner();
```

### 显示欢迎 Banner

```javascript
// 基本用法
banner.show('server');

// 自定义消息
banner.show('server', { 
  customMessage: '正在执行自定义任务...' 
});

// 只显示模式信息
banner.show('generate', { showModeOnly: true });
```

### 显示完成 Banner

```javascript
// 显示编译完成
banner.showComplete('server', '编译');

// 显示部署完成  
banner.showComplete('deploy', '部署');

// 显示缓存清理完成
banner.showComplete('generate', '缓存清理');
```

### 显示错误 Banner

```javascript
banner.showError('generate', '编译过程中发生错误');
```

### 显示状态信息

```javascript
// 信息提示（蓝色）
banner.showStatus('server', '正在初始化组件', 'info');

// 成功信息（绿色）
banner.showStatus('server', '编译完成', 'success'); 

// 警告信息（黄色）
banner.showStatus('server', '发现潜在问题', 'warning');

// 错误信息（红色）
banner.showStatus('server', '编译失败', 'error');
```

## API 参考

### Constructor

创建一个新的 Banner 实例。

```javascript
const banner = new Banner();
```

### banner.show(mode, options)

显示主要的欢迎 banner。

**参数:**
- `mode` (string): 执行模式，如 'server', 'generate', 'deploy' 等
- `options` (Object): 可选参数
  - `showModeOnly` (boolean): 是否只显示模式信息，默认 false
  - `customMessage` (string): 自定义消息，替换默认消息

**示例:**
```javascript
banner.show('server');
banner.show('deploy', { customMessage: '准备部署到生产环境...' });
banner.show('generate', { showModeOnly: true });
```

### banner.showComplete(mode, action)

显示操作完成的 banner。

**参数:**
- `mode` (string): 执行模式
- `action` (string): 完成的操作名称，默认为 '构建'

**示例:**
```javascript
banner.showComplete('server', '编译');
banner.showComplete('deploy', '部署');
```

### banner.showError(mode, error)

显示错误 banner。

**参数:**
- `mode` (string): 执行模式
- `error` (string): 错误信息

**示例:**
```javascript
banner.showError('generate', '编译失败');
```

### banner.showStatus(mode, status, type)

显示简洁的状态信息。

**参数:**
- `mode` (string): 执行模式
- `status` (string): 状态信息
- `type` (string): 消息类型，可选值：'info', 'success', 'warning', 'error'

**示例:**
```javascript
banner.showStatus('server', '正在编译', 'info');
banner.showStatus('server', '编译成功', 'success');
```

### banner.getModeText(mode)

获取模式的中文描述文本。

**参数:**
- `mode` (string): 执行模式

**返回:**
- (string): 模式的中文描述

**示例:**
```javascript
banner.getModeText('server');  // 返回 '开发模式'
banner.getModeText('deploy');  // 返回 '部署模式'
```

## 支持的模式

| 模式代码 | 中文描述 |
|---------|---------|
| server, s | 开发模式 |
| generate, g | 生成模式 |
| deploy, d | 部署模式 |
| 其他 | {模式}模式 |

## 设计理念

1. **关注点分离**: Banner 展示逻辑从主要业务逻辑中分离
2. **一致性**: 提供统一的视觉风格和交互体验
3. **可扩展性**: 易于添加新的展示类型和自定义选项
4. **易用性**: 简单的 API，易于理解和使用

## 测试

运行测试脚本查看所有功能：

```bash
node test-banner.js
```

这将展示所有可用的 banner 类型和样式。 