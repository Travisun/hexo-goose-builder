'use strict';

const chalk = require('chalk');
const fs = require('fs-extra');
const path = require('path');
const readline = require('readline');

/**
 * Tailwind 初始化命令
 * 执行 Tailwind CSS 相关的初始化操作
 */
async function tailwindInitCommand(args) {
  console.log(chalk.green('✓ [Hexo Goose Builder] Tailwind CSS 初始化向导'));
  console.log(chalk.gray('='.repeat(60)));
  
  try {
    // 1. 检查 hexo 配置和主题
    const themeInfo = await checkHexoTheme();
    if (!themeInfo) {
      return;
    }
    
    // 2. 显示主题信息并确认
    const confirmed = await confirmThemeSetup(themeInfo);
    if (!confirmed) {
      console.log(chalk.yellow('[取消] 用户取消了初始化操作'));
      return;
    }
    
    // 3. 创建 tailwind.css 文件
    await createTailwindFile(themeInfo);
    
    // 4. 显示完成信息和使用指导
    showCompletionGuide(themeInfo);
    
  } catch (error) {
    console.log(chalk.red('❌ [错误] 初始化过程中发生错误:'), error.message);
    if (args.debug) {
      console.error(error);
    }
  }
}

/**
 * 检查 Hexo 配置和主题设置
 */
async function checkHexoTheme() {
  console.log(chalk.blue('[步骤 1/4] 检查 Hexo 配置...'));
  
  // 读取 hexo 配置文件
  const configPath = path.join(process.cwd(), '_config.yml');
  
  if (!fs.existsSync(configPath)) {
    console.log(chalk.red('❌ 未找到 Hexo 配置文件 (_config.yml)'));
    console.log(chalk.gray('   请确保在 Hexo 项目根目录下执行此命令'));
    return null;
  }
  
  try {
    const yaml = require('js-yaml');
    const configContent = fs.readFileSync(configPath, 'utf8');
    const config = yaml.load(configContent);
    
    // 检查是否配置了主题
    if (!config.theme || config.theme === 'landscape') {
      console.log(chalk.red('❌ 未配置自定义主题或使用默认主题'));
      console.log(chalk.gray('   当前主题:'), config.theme || '未设置');
      console.log(chalk.yellow('   请先在 _config.yml 中配置自定义主题：'));
      console.log(chalk.gray('   theme: your-theme-name'));
      console.log(chalk.gray('   注意：不支持 Hexo 默认的 landscape 主题'));
      return null;
    }
    
    const themeName = config.theme;
    const themePath = path.join(process.cwd(), 'themes', themeName);
    
    // 检查主题目录是否存在
    if (!fs.existsSync(themePath)) {
      console.log(chalk.red(`❌ 主题目录不存在: ${themePath}`));
      console.log(chalk.gray('   请确保主题已正确安装'));
      return null;
    }
    
    console.log(chalk.green('✓ Hexo 配置检查通过'));
    
    return {
      name: themeName,
      path: themePath,
      configPath: configPath
    };
    
  } catch (error) {
    console.log(chalk.red('❌ 读取配置文件失败:'), error.message);
    return null;
  }
}

/**
 * 显示主题信息并请求用户确认
 */
async function confirmThemeSetup(themeInfo) {
  console.log(chalk.blue('\n[步骤 2/4] 确认主题信息'));
  console.log(chalk.cyan('主题名称:'), chalk.white(themeInfo.name));
  console.log(chalk.cyan('主题路径:'), chalk.gray(themeInfo.path));
  
  // 检查主题是否已经有 tailwind.css
  const tailwindPath = path.join(themeInfo.path, 'tailwind.css');
  const hasExistingFile = fs.existsSync(tailwindPath);
  
  if (hasExistingFile) {
    console.log(chalk.yellow('⚠ 检测到已存在 tailwind.css 文件'));
  }
  
  console.log(chalk.gray('\n即将在此主题下初始化 Tailwind CSS 4 支持'));
  
  return await askConfirmation('是否继续在此主题下启用 Tailwind CSS 4？');
}

/**
 * 创建 tailwind.css 文件
 */
async function createTailwindFile(themeInfo) {
  console.log(chalk.blue('\n[步骤 3/4] 创建 Tailwind CSS 配置文件'));
  
  const tailwindPath = path.join(themeInfo.path, 'tailwind.css');
  const templatePath = path.join(__dirname, 'resources', 'tailwind.css');
  
  // 检查模板文件是否存在
  if (!fs.existsSync(templatePath)) {
    console.log(chalk.red('❌ 模板文件不存在:'), templatePath);
    throw new Error('缺少 tailwind.css 模板文件');
  }
  
  // 如果目标文件已存在，询问是否覆盖
  if (fs.existsSync(tailwindPath)) {
    console.log(chalk.yellow('⚠ tailwind.css 文件已存在'));
    console.log(chalk.gray('覆盖此文件将会：'));
    console.log(chalk.gray('  • 丢失现有的自定义样式配置'));
    console.log(chalk.gray('  • 丢失现有的主题变量定义'));
    console.log(chalk.gray('  • 重置为默认的 Tailwind CSS 4 配置'));
    
    const shouldOverwrite = await askConfirmation('确定要覆盖现有文件吗？');
    if (!shouldOverwrite) {
      console.log(chalk.yellow('[跳过] 保留现有的 tailwind.css 文件'));
      return;
    }
  }
  
  try {
    // 复制模板文件
    fs.copyFileSync(templatePath, tailwindPath);
    console.log(chalk.green('✓ 成功创建 tailwind.css 文件'));
    console.log(chalk.gray('文件位置:'), tailwindPath);
  } catch (error) {
    console.log(chalk.red('❌ 创建文件失败:'), error.message);
    throw error;
  }
}

/**
 * 显示完成信息和使用指导
 */
function showCompletionGuide(themeInfo) {
  console.log(chalk.blue('\n[步骤 4/4] 初始化完成'));
  console.log(chalk.green('🎉 Tailwind CSS 4 初始化成功！'));
  
  console.log(chalk.cyan('\n📋 接下来的步骤：'));
  console.log(chalk.white('1. 在主题的 layout 文件中添加资源引用'));
  console.log(chalk.gray('   在 </head> 标签之前添加以下代码：'));
  console.log('');
  console.log(chalk.bgGray(' <!-- 自动引入主题样式和模块脚本 --> '));
  console.log(chalk.bgGray(' <%- load_theme_assets() %> '));
  console.log('');
  
  console.log(chalk.white('2. 通常需要添加到以下文件或类似文件之一：'));
  console.log(chalk.gray(`   • ${themeInfo.path}/layout/layout.ejs`));
  console.log(chalk.gray(`   • ${themeInfo.path}/layout/_partial/head.ejs`));
  console.log(chalk.gray(`   • ${themeInfo.path}/layout/_partial/html_head.ejs`));
  
  console.log(chalk.white('\n3. 开始使用 Tailwind CSS 4：'));
  console.log(chalk.gray('   • 编辑 tailwind.css 文件自定义主题变量'));
  console.log(chalk.gray('   • 在模板中使用 Tailwind CSS 类名'));
  console.log(chalk.gray('   • 运行 hexo server 查看效果'));
  
  console.log(chalk.white('\n4. 获取帮助：'));
  console.log(chalk.gray('   • Tailwind CSS 4 文档: https://tailwindcss.com/docs'));
  console.log(chalk.gray('   • Hexo Goose Builder 文档: https://github.com/Travisun/hexo-goose-builder'));
  
  console.log(chalk.gray('\n' + '='.repeat(60)));
  console.log(chalk.green('✓ 初始化完成，祝您使用愉快！'));
}

/**
 * 询问用户确认
 */
function askConfirmation(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    
    rl.question(chalk.cyan(`${question} (y/N): `), (answer) => {
      rl.close();
      const confirmed = answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes';
      resolve(confirmed);
    });
  });
}

module.exports = tailwindInitCommand; 