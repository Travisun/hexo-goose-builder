'use strict';

const chalk = require('chalk');

/**
 * 静态模式处理器
 * 专门处理 hexo generate 和 hexo deploy 模式下的逻辑
 */
class StaticModeHandler {
  constructor(themeBuilder) {
    this.themeBuilder = themeBuilder;
    this.hexo = themeBuilder.hexo;
    this.currentMode = themeBuilder.currentMode;
    
    // 添加状态跟踪，防止重复操作
    this.hasInitialized = false;
    this.hasCopiedAssets = false;
  }

  /**
   * 检查是否为部署模式
   */
  isDeployMode() {
    return this.currentMode === 'deploy';
  }

  /**
   * 检查是否为生成模式
   */
  isGenerateMode() {
    return this.currentMode === 'generate';
  }

  /**
   * 初始化静态模式
   */
  async initialize() {
    if (this.hasInitialized) {
      console.log(chalk.gray(`[Static Mode] ${this.currentMode}模式已初始化，跳过重复初始化`));
      return;
    }
    
    console.log(chalk.blue(`[Static Mode] 初始化${this.currentMode}模式处理器...`));
    
    // 对于 Deploy 模式，简化初始化逻辑
    if (this.isDeployMode()) {
      console.log(chalk.blue('[Static Mode] Deploy模式：使用简化初始化流程...'));
      
      // Deploy 模式只在未编译时进行编译，不进行资源复制
      if (!this.themeBuilder.hasCompiled) {
        console.log(chalk.blue('[Static Mode] Deploy模式：执行必要的资源编译...'));
        await this.themeBuilder.compileAssets();
      } else {
        console.log(chalk.green('[Static Mode] ✓ Deploy模式：资源已编译完成'));
      }
    } else {
      // Generate模式的处理逻辑
      if (!this.themeBuilder.hasCompiled) {
        console.log(chalk.blue(`[Static Mode] ${this.currentMode}模式：在初始化中执行编译...`));
        await this.themeBuilder.compileAssets();
        
        // 立即将编译的CSS文件复制到public目录
        await this.copyCompiledAssetsToPublic();
      } else {
        console.log(chalk.green(`[Static Mode] ✓ ${this.currentMode}模式：资源已在ready事件中编译，跳过重复编译`));
        
        // 即使资源已编译，也确保public目录中有文件
        await this.copyCompiledAssetsToPublic();
      }
    }
    
    this.hasInitialized = true;
    console.log(chalk.green(`[Static Mode] ✓ ${this.currentMode}模式初始化完成`));
  }

  /**
   * 注册静态模式相关的事件处理器
   */
  registerEvents() {
    // 为部署模式添加专门的事件处理
    if (this.isDeployMode()) {
      this.registerDeployEvents();
    }

    // 新增：在ready事件后立即编译，确保在任何生成操作之前完成
    this.hexo.on('ready', async () => {
      console.log(chalk.blue(`[Static Mode] ==> ready 事件触发（${this.currentMode}模式），提前编译资源...`));
      
      try {
        console.log(chalk.yellow(`[Static Mode] ${this.currentMode}模式：在ready事件中强制编译，确保资源在主题文件复制前完成...`));
        await this.themeBuilder.compileAssets();
        console.log(chalk.green('[Static Mode] ✓ ready 事件编译完成'));
        
        // 验证编译结果
        await this.themeBuilder.verifyCompiledAssets();
        
        // 只在非Deploy模式下立即复制资源
        if (!this.isDeployMode()) {
          await this.copyCompiledAssetsToPublic();
        }
      } catch (error) {
        console.error(chalk.red('[Static Mode] ❌ ready 事件编译失败:'), error);
        throw error; // 抛出错误以阻止生成过程
      }
    });

    // 在静态生成模式下使用generateBefore事件强制编译
    this.hexo.on('generateBefore', async () => {
      console.log(chalk.blue(`[Static Mode] ==> generateBefore 事件触发（${this.currentMode}模式），检查编译状态...`));
      
      try {
        if (!this.themeBuilder.hasCompiled) {
          console.log(chalk.yellow(`[Static Mode] ${this.currentMode}模式：在generateBefore中强制编译...`));
          await this.themeBuilder.compileAssets();
          console.log(chalk.green('[Static Mode] ✓ generateBefore 编译完成'));
          
          // 验证编译结果
          await this.themeBuilder.verifyCompiledAssets();
          
          // 只在非Deploy模式下立即复制资源
          if (!this.isDeployMode()) {
            await this.copyCompiledAssetsToPublic();
          }
        } else {
          console.log(chalk.green(`[Static Mode] ✓ ${this.currentMode}模式：资源已在ready事件中编译完成`));
          
          // 只在非Deploy模式下确保资源存在
          if (!this.isDeployMode()) {
            await this.copyCompiledAssetsToPublic();
          }
        }
      } catch (error) {
        console.error(chalk.red('[Static Mode] ❌ generateBefore 编译失败:'), error);
        throw error; // 抛出错误以阻止生成过程
      }
    });

    // before_generate过滤器 - 确保编译完成
    this.hexo.extend.filter.register('before_generate', async () => {
      console.log(chalk.blue(`[Static Mode] ==> before_generate 过滤器执行（${this.currentMode}模式）...`));
      
      if (!this.themeBuilder.hasCompiled) {
        console.log(chalk.yellow(`[Static Mode] ${this.currentMode}模式：在before_generate中强制编译...`));
        try {
          await this.themeBuilder.compileAssets();
          await this.themeBuilder.verifyCompiledAssets();
          
          // 只在非Deploy模式下立即复制资源
          if (!this.isDeployMode()) {
            await this.copyCompiledAssetsToPublic();
          }
          console.log(chalk.green(`[Static Mode] ✓ ${this.currentMode}模式before_generate编译完成`));
        } catch (error) {
          console.error(chalk.red(`[Static Mode] ❌ ${this.currentMode}模式before_generate编译失败:`), error);
          throw error; // 抛出错误以阻止生成过程
        }
      } else {
        console.log(chalk.green(`[Static Mode] ✓ ${this.currentMode}模式：资源已编译，跳过重复编译`));
      }
    }, 0); // 最高优先级

    // 新增：after_generate 事件，确保public目录中有编译的文件
    this.hexo.on('generateAfter', async () => {
      console.log(chalk.blue(`[Static Mode] ==> generateAfter 事件触发（${this.currentMode}模式），确保资源复制完成...`));
      try {
        // 在generate完成后，确保编译的资源文件存在于public目录
        if (!this.hasCopiedAssets || !this.isDeployMode()) {
          await this.copyCompiledAssetsToPublic();
        }
      } catch (error) {
        console.error(chalk.red('[Static Mode] ❌ generateAfter 复制资源失败:'), error);
      }
    });
  }

  /**
   * 注册部署模式专用事件
   */
  registerDeployEvents() {
    // 部署前事件 - 简化逻辑，只验证不重复编译
    this.hexo.on('deployBefore', async () => {
      console.log(chalk.blue('[Static Mode] ==> deployBefore 事件触发（Deploy模式），验证编译状态...'));
      
      try {
        // 检查编译状态，只有在未编译时才强制编译
        if (!this.themeBuilder.hasCompiled) {
          console.log(chalk.yellow('[Static Mode] Deploy模式：检测到未编译状态，强制编译...'));
          await this.themeBuilder.compileAssets();
          console.log(chalk.green('[Static Mode] ✓ deployBefore 编译完成'));
        } else {
          console.log(chalk.green('[Static Mode] ✓ Deploy模式：资源已编译完成'));
        }
        
        // 验证编译结果
        await this.themeBuilder.verifyCompiledAssets();
        
        // 在部署前最后一次确保资源存在（不清空目录）
        await this.safeEnsureAssetsInPublic();
        
        console.log(chalk.green('[Static Mode] ✓ Deploy模式：资源编译验证通过，可以开始部署'));
      } catch (error) {
        console.error(chalk.red('[Static Mode] ❌ deployBefore 验证失败:'), error);
        throw error; // 抛出错误以阻止部署过程
      }
    });

    // 部署完成后清理（可选）
    this.hexo.on('deployAfter', () => {
      console.log(chalk.green('[Static Mode] ✓ Deploy模式：部署完成'));
    });

    // 为部署模式添加 before_deploy 过滤器 - 降低优先级，避免干扰
    this.hexo.extend.filter.register('before_deploy', async () => {
      console.log(chalk.blue('[Static Mode] ==> before_deploy 过滤器执行（Deploy模式）...'));
      
      // 只做最基本的验证，不进行复制操作
      if (!this.themeBuilder.hasCompiled) {
        console.log(chalk.yellow('[Static Mode] Deploy模式：在before_deploy中强制编译...'));
        try {
          await this.themeBuilder.compileAssets();
          await this.themeBuilder.verifyCompiledAssets();
          console.log(chalk.green('[Static Mode] ✓ Deploy模式before_deploy编译完成'));
        } catch (error) {
          console.error(chalk.red('[Static Mode] ❌ Deploy模式before_deploy编译失败:'), error);
          throw error; // 抛出错误以阻止部署过程
        }
      } else {
        console.log(chalk.green('[Static Mode] ✓ Deploy模式：资源已编译，可以开始部署'));
      }
    }, 10); // 降低优先级，避免干扰Hexo正常流程
  }

  /**
   * 获取资源标签的静态模式特殊处理
   */
  handleGetAssetTags() {
    // 对于静态生成模式，如果没有找到任何资源且还未编译，发出警告
    if (!this.themeBuilder.hasCompiled && !this.themeBuilder.isCompiling) {
      if (this.isDeployMode()) {
        console.log(chalk.red('[Static Mode] ❌ Deploy模式：未找到编译资源，这可能导致部署的网站缺少样式和脚本！'));
      } else {
        console.log(chalk.yellow('[Static Mode] ⚠ Generate模式：未找到编译资源，尝试立即编译...'));
        // 异步编译，不阻塞当前流程
        this.themeBuilder.compileAssets().catch(error => {
          console.error(chalk.red('[Static Mode] ❌ Generate模式立即编译失败:'), error);
        });
      }
    }
  }

  /**
   * 强制编译并验证
   * 用于确保静态生成模式下的资源完整性
   */
  async forceCompileAndVerify() {
    console.log(chalk.blue(`[Static Mode] ${this.currentMode}模式：强制编译并验证资源...`));
    
    try {
      // 重置编译状态
      this.themeBuilder.hasCompiled = false;
      
      // 强制编译
      await this.themeBuilder.compileAssets();
      
      // 验证编译结果
      await this.themeBuilder.verifyCompiledAssets();
      
      console.log(chalk.green(`[Static Mode] ✓ ${this.currentMode}模式：强制编译并验证完成`));
      return true;
    } catch (error) {
      console.error(chalk.red(`[Static Mode] ❌ ${this.currentMode}模式强制编译失败:`), error);
      throw error;
    }
  }

  /**
   * 预编译检查
   * 在关键操作前检查编译状态
   */
  async preCompileCheck() {
    if (!this.themeBuilder.hasCompiled) {
      console.log(chalk.yellow(`[Static Mode] ${this.currentMode}模式：检测到未编译状态，执行预编译...`));
      await this.forceCompileAndVerify();
    } else {
      console.log(chalk.green(`[Static Mode] ✓ ${this.currentMode}模式：预编译检查通过`));
    }
  }

  /**
   * 部署前最终检查
   */
  async finalDeployCheck() {
    if (!this.isDeployMode()) return;
    
    console.log(chalk.blue('[Static Mode] Deploy模式：执行部署前最终检查...'));
    
    try {
      // 验证编译状态
      if (!this.themeBuilder.hasCompiled) {
        throw new Error('资源未编译，无法安全部署');
      }
      
      // 验证编译后的资源文件
      await this.themeBuilder.verifyCompiledAssets();
      
      console.log(chalk.green('[Static Mode] ✓ Deploy模式：最终检查通过，可以安全部署'));
    } catch (error) {
      console.error(chalk.red('[Static Mode] ❌ Deploy模式最终检查失败:'), error);
      throw error;
    }
  }

  /**
   * 清理资源（静态模式通常不需要特殊清理）
   */
  cleanup() {
    console.log(chalk.gray(`[Static Mode] ${this.currentMode}模式清理完成`));
  }

  /**
   * 安全地确保资源文件存在于public目录（不清空现有文件）
   */
  async safeEnsureAssetsInPublic() {
    const fs = require('fs');
    const path = require('path');
    const Utils = require('./utils');
    
    try {
      console.log(chalk.blue(`[Static Mode] 安全确保主题资源文件存在于public目录...`));
      
      const publicCssDir = path.join(this.hexo.public_dir, 'css');
      const publicJsDir = path.join(this.hexo.public_dir, 'js');
      const themeCssDir = path.join(this.hexo.theme_dir, 'source/css');
      const themeJsDir = path.join(this.hexo.theme_dir, 'source/js');
      
      // 确保public目录存在，但不清空
      Utils.ensureDirectoryExists(publicCssDir);
      Utils.ensureDirectoryExists(publicJsDir);
      
      let copiedCount = 0;
      
      // 安全复制CSS文件（只复制不存在的文件）
      if (fs.existsSync(themeCssDir)) {
        copiedCount += await this.safelyCopyDirectoryFiles(themeCssDir, publicCssDir, 'CSS');
      }
      
      // 安全复制JS文件（只复制不存在的文件）
      if (fs.existsSync(themeJsDir)) {
        copiedCount += await this.safelyCopyDirectoryFiles(themeJsDir, publicJsDir, 'JS');
      }
      
      if (copiedCount > 0) {
        console.log(chalk.green(`[Static Mode] ✓ 安全复制了 ${copiedCount} 个缺失的资源文件到public目录`));
      } else {
        console.log(chalk.blue(`[Static Mode] ✓ 所有必要的资源文件都已存在于public目录`));
      }
      
      this.hasCopiedAssets = true;
      
    } catch (error) {
      console.error(chalk.red('[Static Mode] ❌ 安全确保资源时出错:'), error);
      // 不抛出错误，因为这是安全操作
    }
  }

  /**
   * 安全地复制文件（只复制不存在的文件）
   */
  async safelyCopyDirectoryFiles(srcDir, destDir, fileType) {
    const fs = require('fs');
    const path = require('path');
    const Utils = require('./utils');
    
    let copiedCount = 0;
    
    // 确保目标目录存在
    Utils.ensureDirectoryExists(destDir);
    
    try {
      const items = fs.readdirSync(srcDir, { withFileTypes: true });
      
      for (const item of items) {
        const srcPath = path.join(srcDir, item.name);
        const destPath = path.join(destDir, item.name);
        
        if (item.isDirectory()) {
          // 递归处理子目录
          copiedCount += await this.safelyCopyDirectoryFiles(srcPath, destPath, fileType);
        } else if (item.isFile()) {
          try {
            // 只在目标文件不存在时才复制
            if (!fs.existsSync(destPath)) {
              const content = fs.readFileSync(srcPath);
              fs.writeFileSync(destPath, content);
              
              console.log(chalk.green(`[Static Mode] ✓ 安全复制${fileType}文件: ${item.name}`));
              copiedCount++;
            }
          } catch (error) {
            console.error(chalk.red(`[Static Mode] ❌ 安全复制${fileType}文件失败 ${item.name}:`), error.message);
          }
        }
      }
    } catch (error) {
      console.error(chalk.red(`[Static Mode] ❌ 安全读取${fileType}目录失败 ${srcDir}:`), error.message);
    }
    
    return copiedCount;
  }

  /**
   * 将主题目录下的所有资源文件复制到public目录
   */
  async copyCompiledAssetsToPublic() {
    // 防止在Deploy模式下重复执行
    if (this.isDeployMode() && this.hasCopiedAssets) {
      console.log(chalk.gray('[Static Mode] Deploy模式：资源已复制，跳过重复操作'));
      return;
    }
    
    const fs = require('fs');
    const path = require('path');
    const Utils = require('./utils');
    
    try {
      console.log(chalk.blue(`[Static Mode] 复制主题资源文件到public目录...`));
      
      const publicCssDir = path.join(this.hexo.public_dir, 'css');
      const publicJsDir = path.join(this.hexo.public_dir, 'js');
      const themeCssDir = path.join(this.hexo.theme_dir, 'source/css');
      const themeJsDir = path.join(this.hexo.theme_dir, 'source/js');
      
      // 在Deploy模式下，不清空目录，改为安全复制
      if (this.isDeployMode()) {
        console.log(chalk.blue('[Static Mode] Deploy模式：使用安全复制模式，不清空现有文件'));
        return await this.safeEnsureAssetsInPublic();
      }
      
      // 只在非Deploy模式下清空目标目录
      await this.clearPublicDirectory(publicCssDir, 'CSS');
      await this.clearPublicDirectory(publicJsDir, 'JS');
      
      // 确保public目录存在
      Utils.ensureDirectoryExists(publicCssDir);
      Utils.ensureDirectoryExists(publicJsDir);
      
      let copiedCount = 0;
      
      // 复制所有CSS文件（包括子目录）
      if (fs.existsSync(themeCssDir)) {
        copiedCount += await this.copyDirectoryFiles(themeCssDir, publicCssDir, 'CSS');
      } else {
        console.warn(chalk.yellow(`[Static Mode] ⚠ 主题CSS目录不存在: ${themeCssDir}`));
      }
      
      // 复制所有JS文件
      if (fs.existsSync(themeJsDir)) {
        copiedCount += await this.copyDirectoryFiles(themeJsDir, publicJsDir, 'JS');
      } else {
        console.warn(chalk.yellow(`[Static Mode] ⚠ 主题JS目录不存在: ${themeJsDir}`));
      }
      
      if (copiedCount > 0) {
        console.log(chalk.green(`[Static Mode] ✓ 成功复制 ${copiedCount} 个资源文件到public目录`));
      } else {
        console.log(chalk.blue(`[Static Mode] ✓ 所有资源文件已同步到public目录`));
      }
      
      this.hasCopiedAssets = true;
      
    } catch (error) {
      console.error(chalk.red('[Static Mode] ❌ 复制主题资源到public目录时出错:'), error);
      throw error; // 重新抛出错误，让调用者处理
    }
  }

  /**
   * 递归复制目录中的所有文件
   */
  async copyDirectoryFiles(srcDir, destDir, fileType) {
    const fs = require('fs');
    const path = require('path');
    const Utils = require('./utils');
    
    let copiedCount = 0;
    
    // 确保目标目录存在
    Utils.ensureDirectoryExists(destDir);
    
    try {
      const items = fs.readdirSync(srcDir, { withFileTypes: true });
      
      for (const item of items) {
        const srcPath = path.join(srcDir, item.name);
        const destPath = path.join(destDir, item.name);
        
        if (item.isDirectory()) {
          // 递归复制子目录
          copiedCount += await this.copyDirectoryFiles(srcPath, destPath, fileType);
        } else if (item.isFile()) {
          try {
            // 直接复制文件（因为目录已经清空）
            const content = fs.readFileSync(srcPath);
            fs.writeFileSync(destPath, content);
            
            console.log(chalk.green(`[Static Mode] ✓ 已复制${fileType}文件: ${item.name}`));
            copiedCount++;
          } catch (error) {
            console.error(chalk.red(`[Static Mode] ❌ 复制${fileType}文件失败 ${item.name}:`), error.message);
          }
        }
      }
    } catch (error) {
      console.error(chalk.red(`[Static Mode] ❌ 读取${fileType}目录失败 ${srcDir}:`), error.message);
    }
    
    return copiedCount;
  }

  /**
   * 清空public目录，避免遗留旧文件
   */
  async clearPublicDirectory(dirPath, fileType) {
    const fs = require('fs');
    const path = require('path');
    
    try {
      if (!fs.existsSync(dirPath)) {
        console.log(chalk.gray(`[Static Mode] ${fileType}目录不存在，跳过清空: ${path.basename(dirPath)}`));
        return;
      }
      
      console.log(chalk.blue(`[Static Mode] 清空${fileType}目录: ${path.basename(dirPath)}`));
      
      const items = fs.readdirSync(dirPath, { withFileTypes: true });
      let deletedCount = 0;
      
      for (const item of items) {
        const itemPath = path.join(dirPath, item.name);
        
        try {
          if (item.isDirectory()) {
            // 递归删除子目录
            await this.removeDirectory(itemPath);
            console.log(chalk.yellow(`[Static Mode] ✓ 已删除${fileType}子目录: ${item.name}`));
          } else {
            // 删除文件
            fs.unlinkSync(itemPath);
            console.log(chalk.gray(`[Static Mode] ✓ 已删除${fileType}文件: ${item.name}`));
          }
          deletedCount++;
        } catch (error) {
          console.error(chalk.red(`[Static Mode] ❌ 删除${fileType}项目失败 ${item.name}:`), error.message);
        }
      }
      
      if (deletedCount > 0) {
        console.log(chalk.green(`[Static Mode] ✓ 成功清空${fileType}目录，删除了 ${deletedCount} 个项目`));
      } else {
        console.log(chalk.gray(`[Static Mode] ✓ ${fileType}目录已为空`));
      }
      
    } catch (error) {
      console.error(chalk.red(`[Static Mode] ❌ 清空${fileType}目录失败 ${dirPath}:`), error.message);
      // 不抛出错误，继续执行复制操作
    }
  }

  /**
   * 递归删除目录及其内容
   */
  async removeDirectory(dirPath) {
    const fs = require('fs');
    const path = require('path');
    
    if (!fs.existsSync(dirPath)) {
      return;
    }
    
    const items = fs.readdirSync(dirPath, { withFileTypes: true });
    
    for (const item of items) {
      const itemPath = path.join(dirPath, item.name);
      
      if (item.isDirectory()) {
        await this.removeDirectory(itemPath);
      } else {
        fs.unlinkSync(itemPath);
      }
    }
    
    fs.rmdirSync(dirPath);
  }
}

module.exports = StaticModeHandler; 