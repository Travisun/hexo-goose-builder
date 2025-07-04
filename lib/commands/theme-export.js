'use strict';

const fs = require('fs');
const path = require('path');
const chalk = require('chalk');
const archiver = require('archiver');
const glob = require('glob');

class ThemeExporter {
  constructor(hexo, customThemeName = null) {
    this.hexo = hexo;
    this.hexoRoot = this.hexo.base_dir;
    this.targetRoot = path.join(this.hexoRoot, 'theme_dist');
    
    // 使用指定的主题名称或默认主题
    if (customThemeName) {
      this.themeName = customThemeName;
      this.themeRoot = path.join(this.hexoRoot, 'themes', customThemeName);
      this.isCustomTheme = true;
    } else {
      this.themeName = this.hexo.config.theme;
      this.themeRoot = this.hexo.theme_dir;
      this.isCustomTheme = false;
    }
    
    this.targetDir = path.join(this.targetRoot, this.themeName);
  }

  // 主导出流程
  async export() {
    console.log(chalk.blue('\n🎨 Hexo Goose Builder - 主题导出工具\n'));

    try {
      // 1. 验证主题信息
      await this.validateTheme();

      // 2. 用户确认主题信息
      const confirmed = await this.confirmThemeInfo();
      if (!confirmed) {
        console.log(chalk.yellow('导出已取消'));
        return;
      }

      // 3. 检查目标目录并确认清理
      await this.handleExistingTarget();

      // 4. 编译主题资源
      await this.compileThemeAssets();

      // 5. 复制核心文件
      await this.copyCorePaths();

      // 6. 处理其他文件
      await this.handleAdditionalFiles();

      // 7. 替换模板中的资源引用
      await this.replaceAssetReferences();

      // 8. 打包主题
      const zipPath = await this.packageTheme();

      // 9. 显示完成信息
      this.showCompletionInfo(zipPath);

    } catch (error) {
      console.error(chalk.red('❌ 导出失败:'), error.message);
      if (this.hexo.config.theme_builder && this.hexo.config.theme_builder.debug) {
        console.error(error.stack);
      }
    }
  }

  // 验证主题
  async validateTheme() {
    if (!this.themeName) {
      if (this.isCustomTheme) {
        throw new Error('未指定主题名称');
      } else {
        throw new Error('未配置主题，请在 _config.yml 中设置 theme 字段，或使用 hexo goose theme-export <theme_name> 指定主题');
      }
    }

    if (!fs.existsSync(this.themeRoot)) {
      if (this.isCustomTheme) {
        throw new Error(`指定的主题目录不存在: ${this.themeRoot}\n请检查主题名称是否正确，或确保主题已安装在 themes/ 目录下`);
      } else {
        throw new Error(`配置的主题目录不存在: ${this.themeRoot}`);
      }
    }

    const themeType = this.isCustomTheme ? '指定主题' : '配置主题';
    console.log(chalk.green(`✓ 检测到${themeType}: ${this.themeName}`));
    console.log(chalk.gray(`  主题路径: ${this.themeRoot}`));
  }

  // 用户确认主题信息
  async confirmThemeInfo() {
    const inquirer = await import('inquirer');
    const answers = await inquirer.default.prompt([
      {
        type: 'input',
        name: 'themeName',
        message: '请确认主题名称:',
        default: this.themeName,
        validate: (input) => {
          if (!input.trim()) {
            return '主题名称不能为空';
          }
          if (!/^[a-zA-Z0-9_-]+$/.test(input)) {
            return '主题名称只能包含字母、数字、下划线和横线';
          }
          return true;
        }
      },
      {
        type: 'input',
        name: 'targetPath',
        message: '请确认导出路径:',
        default: this.targetRoot,
        validate: (input) => {
          if (!input.trim()) {
            return '导出路径不能为空';
          }
          return true;
        }
      },
      {
        type: 'confirm',
        name: 'proceed',
        message: '确认开始导出?',
        default: true
      }
    ]);

    if (!answers.proceed) {
      return false;
    }

    // 更新配置
    this.themeName = answers.themeName;
    this.targetRoot = answers.targetPath;
    this.targetDir = path.join(this.targetRoot, this.themeName);

    return true;
  }

  // 处理已存在的目标目录
  async handleExistingTarget() {
    if (fs.existsSync(this.targetDir)) {
      console.log(chalk.yellow(`⚠ 目标目录已存在: ${this.targetDir}`));
      
      const inquirer = await import('inquirer');
      const answer = await inquirer.default.prompt([
        {
          type: 'confirm',
          name: 'clearTarget',
          message: chalk.red('清理现有目录? (警告: 这将删除所有现有文件且无法恢复)'),
          default: false
        }
      ]);

      if (!answer.clearTarget) {
        throw new Error('用户取消了导出操作');
      }

      console.log(chalk.blue('🗑️ 清理现有目录...'));
      fs.rmSync(this.targetDir, { recursive: true, force: true });
      console.log(chalk.green('✓ 目录清理完成'));
    }

    // 确保目标目录存在
    fs.mkdirSync(this.targetDir, { recursive: true });
  }

  // 编译主题资源
  async compileThemeAssets() {
    console.log(chalk.blue('🔧 编译主题资源...'));
    
    try {
      // 通过 hexo.goose_builder 获取 ThemeBuilder 实例
      if (this.hexo.goose_builder && this.hexo.goose_builder.compileAssets) {
        await this.hexo.goose_builder.compileAssets();
        console.log(chalk.green('✓ 资源编译完成'));
      } else {
        console.warn(chalk.yellow('⚠ 未找到 ThemeBuilder 实例，跳过资源编译'));
      }
    } catch (error) {
      console.warn(chalk.yellow('⚠ 资源编译失败，将使用现有资源文件'));
      console.warn(chalk.gray(`  错误: ${error.message}`));
    }
  }

  // 复制核心路径
  async copyCorePaths() {
    const corePaths = [
      { 
        source: 'layout', 
        target: 'layout', 
        filter: (filePath) => {
          // 标准化路径分隔符以确保跨平台兼容性
          const normalizedPath = filePath.replace(/\\/g, '/');
          
          // 对于 layout/components/** 递归目录，严格过滤只保留 .ejs 文件
          if (normalizedPath.includes('layout/components/')) {
            // 检查是否为目录
            const stat = fs.statSync(filePath);
            if (stat.isDirectory()) {
              // 目录允许通过，在其内部的文件会被递归处理
              console.log(chalk.blue(`    📁 进入目录 ${path.relative(this.themeRoot, filePath)}`));
              return true;
            }
            
            // 对于文件，进行严格的扩展名过滤
            const ext = path.extname(filePath).toLowerCase();
            const isEjsFile = ext === '.ejs';
            
            // 明确排除的文件类型
            const excludedExtensions = ['.css', '.js', '.scss', '.sass', '.less', '.json', '.md', '.txt', '.map'];
            const isExcluded = excludedExtensions.includes(ext);
            
            if (isExcluded) {
              console.log(chalk.gray(`    ⊘ 跳过 ${path.relative(this.themeRoot, filePath)} (${ext} 文件)`));
              return false;
            }
            
            if (isEjsFile) {
              console.log(chalk.blue(`    ✓ 复制 ${path.relative(this.themeRoot, filePath)} (模板文件)`));
              return true;
            }
            
            // 对于其他未明确定义的文件类型，也跳过以确保安全
            console.log(chalk.gray(`    ⊘ 跳过 ${path.relative(this.themeRoot, filePath)} (未知类型: ${ext || '无扩展名'})`));
            return false;
          }
          
          // layout/components/ 之外的文件正常复制
          return true;
        }
      },
      { source: 'languages', target: 'languages' },
      { source: 'scripts', target: 'scripts' },
      { source: 'source', target: 'source' }
    ];

    for (const pathInfo of corePaths) {
      const sourcePath = path.join(this.themeRoot, pathInfo.source);
      const targetPath = path.join(this.targetDir, pathInfo.target);

      if (fs.existsSync(sourcePath)) {
        console.log(chalk.blue(`📁 复制 ${pathInfo.source}/...`));
        const hasContent = await this.copyDirectory(sourcePath, targetPath, pathInfo.filter);
        if (hasContent) {
          console.log(chalk.green(`✓ ${pathInfo.source}/ 复制完成`));
        } else {
          console.log(chalk.gray(`⚪ ${pathInfo.source}/ 无有效内容，跳过`));
        }
      } else {
        console.log(chalk.gray(`⚪ ${pathInfo.source}/ 不存在，跳过`));
      }
    }

    // 复制配置文件
    const configSource = path.join(this.themeRoot, '_config.example.yml');
    const configTarget = path.join(this.targetDir, '_config.yml');
    
    if (fs.existsSync(configSource)) {
      console.log(chalk.blue('📄 复制配置文件...'));
      fs.copyFileSync(configSource, configTarget);
      console.log(chalk.green('✓ _config.yml 复制完成'));
    } else {
      console.log(chalk.yellow('⚠ _config.example.yml 不存在，跳过配置文件复制'));
    }
  }

  // 处理其他文件
  async handleAdditionalFiles() {
    const coreItems = new Set(['layout', 'languages', 'scripts', 'source', '_config.yml', '_config.example.yml']);
    const excludeItems = new Set(['tailwind.css']); // 额外排除的文件
    const allItems = fs.readdirSync(this.themeRoot);
    const additionalItems = allItems.filter(item => {
      const fullPath = path.join(this.themeRoot, item);
      
      // 排除核心项目
      if (coreItems.has(item)) {
        return false;
      }
      
      // 排除特定的主题文件
      if (excludeItems.has(item)) {
        return false;
      }
      
      // 排除隐藏文件和特殊目录
      if (item.startsWith('.') || item === 'node_modules') {
        return false;
      }
      
      // 排除临时文件和日志文件
      if (item.endsWith('.log') || item.endsWith('.tmp')) {
        return false;
      }
      
      // 检查文件/目录是否存在且可访问
      try {
        fs.statSync(fullPath);
        return true;
      } catch (error) {
        return false;
      }
    });

    if (additionalItems.length === 0) {
      console.log(chalk.gray('⚪ 未发现其他需要处理的文件'));
      return;
    }

    console.log(chalk.blue('\n📋 发现以下额外文件/文件夹:'));
    additionalItems.forEach(item => {
      const fullPath = path.join(this.themeRoot, item);
      const isDir = fs.statSync(fullPath).isDirectory();
      console.log(chalk.gray(`  ${isDir ? '📁' : '📄'} ${item}`));
    });

    const inquirer = await import('inquirer');
    const answer = await inquirer.default.prompt([
      {
        type: 'checkbox',
        name: 'selectedItems',
        message: '请选择要复制的项目:',
        choices: additionalItems.map(item => ({
          name: item,
          value: item,
          checked: false
        }))
      }
    ]);

    for (const item of answer.selectedItems) {
      const sourcePath = path.join(this.themeRoot, item);
      const targetPath = path.join(this.targetDir, item);
      
      console.log(chalk.blue(`📁 复制 ${item}...`));
      
      if (fs.statSync(sourcePath).isDirectory()) {
        const hasContent = await this.copyDirectory(sourcePath, targetPath);
        if (!hasContent) {
          console.log(chalk.gray(`    ⚪ ${item} 目录无有效内容`));
        }
      } else {
        fs.copyFileSync(sourcePath, targetPath);
      }
      
      console.log(chalk.green(`✓ ${item} 复制完成`));
    }
  }

  // 替换模板中的资源引用
  async replaceAssetReferences() {
    console.log(chalk.blue('🔄 处理模板资源引用...'));

    const layoutDir = path.join(this.targetDir, 'layout');
    if (!fs.existsSync(layoutDir)) {
      console.log(chalk.gray('⚪ layout 目录不存在，跳过资源引用处理'));
      return;
    }

    // 获取资源文件信息
    const assetTags = this.generateAssetTags();

    // 查找所有 .ejs 文件
    const ejsFiles = glob.sync('**/*.ejs', { 
      cwd: layoutDir,
      absolute: true 
    });

    let processedCount = 0;

    for (const filePath of ejsFiles) {
      let content = fs.readFileSync(filePath, 'utf8');
      const originalContent = content;

      // 替换 <%- load_theme_assets() %>
      const regex = /<%[-=]\s*load_theme_assets\(\s*\)\s*%>/g;
      
      if (regex.test(content)) {
        content = content.replace(regex, assetTags);
        
        if (content !== originalContent) {
          fs.writeFileSync(filePath, content, 'utf8');
          processedCount++;
          
          const relativePath = path.relative(layoutDir, filePath);
          console.log(chalk.green(`  ✓ ${relativePath} - 资源引用已替换`));
        }
      }
    }

    if (processedCount > 0) {
      console.log(chalk.green(`✓ 已处理 ${processedCount} 个模板文件的资源引用`));
    } else {
      console.log(chalk.gray('⚪ 未发现需要替换的资源引用'));
    }
  }

  // 生成资源标签
  generateAssetTags() {
    const tags = [];
    
    try {
      // 检查 CSS 文件
      const cssDir = path.join(this.targetDir, 'source/css');
      if (fs.existsSync(cssDir)) {
        const cssFiles = fs.readdirSync(cssDir);
        
        const componentCssFiles = cssFiles.filter(file => {
          return (
            file.match(/^components\.styles\.[a-f0-9]{8}\.css$/) ||
            file.match(/^components\.bundle\.[a-z0-9]{6}\.css$/) ||
            file.match(/^component\.bundle\.[a-z0-9]{6}\.css$/)
          );
        });

        componentCssFiles.sort().forEach(file => {
          tags.push(`<link rel="stylesheet" href="/css/${file}">`);
        });
      }
      
      // 检查 JS 文件
      const jsDir = path.join(this.targetDir, 'source/js');
      if (fs.existsSync(jsDir)) {
        const jsFiles = fs.readdirSync(jsDir);
        
        const componentFiles = jsFiles
          .filter(file => file.startsWith('components.') && file.endsWith('.js') && !file.includes('loader'))
          .sort((a, b) => {
            const getNumber = (filename) => {
              const match = filename.match(/components\.([^.]+)/);
              return match ? match[1] : '';
            };
            const numA = getNumber(a);
            const numB = getNumber(b);
            return numA.localeCompare(numB);
          });
        
        componentFiles.forEach(file => {
          tags.push(`<script type="module" src="/js/${file}"></script>`);
        });
      }
    } catch (error) {
      console.warn(chalk.yellow('⚠ 生成资源标签时出错:'), error.message);
    }
    
    return tags.join('\n');
  }

  // 打包主题
  async packageTheme() {
    console.log(chalk.blue('📦 打包主题...'));

    // 生成格式为 YYYY-MM-DD-HHMMSS 的时间戳
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10); // YYYY-MM-DD
    const timeStr = now.toISOString().slice(11, 19).replace(/:/g, ''); // HHMMSS
    const timestamp = `${dateStr}-${timeStr}`;
    
    const zipName = `${this.themeName}-${timestamp}.zip`;
    const zipPath = path.join(this.targetRoot, zipName);

    return new Promise((resolve, reject) => {
      const output = fs.createWriteStream(zipPath);
      const archive = archiver('zip', {
        zlib: { level: 9 }
      });

      output.on('close', () => {
        resolve(zipPath);
      });

      archive.on('error', (err) => {
        reject(err);
      });

      archive.pipe(output);
      archive.directory(this.targetDir, this.themeName);
      archive.finalize();
    });
  }

  // 显示完成信息
  showCompletionInfo(zipPath) {
    const zipSize = fs.statSync(zipPath).size;
    const zipSizeMB = (zipSize / 1024 / 1024).toFixed(2);

    console.log(chalk.green('\n🎉 主题导出完成!'));
    console.log(chalk.blue('\n📊 导出信息:'));
    console.log(chalk.gray(`  主题名称: ${this.themeName}`));
    console.log(chalk.gray(`  导出目录: ${this.targetDir}`));
    console.log(chalk.gray(`  打包文件: ${path.basename(zipPath)}`));
    console.log(chalk.gray(`  文件大小: ${zipSizeMB} MB`));
    console.log(chalk.gray(`  完整路径: ${zipPath}`));
    
    console.log(chalk.blue('\n📝 后续步骤:'));
    console.log(chalk.gray('  1. 检查导出的主题文件'));
    console.log(chalk.gray('  2. 测试主题在其他 Hexo 站点中的兼容性'));
    console.log(chalk.gray('  3. 发布到主题市场或 Git 仓库'));
    console.log('');
  }

  // 递归复制目录（智能处理空目录）
  async copyDirectory(source, target, filter = null) {
    const items = fs.readdirSync(source);
    let hasValidContent = false; // 标记是否有有效内容需要复制

    // 第一遍：检查并处理文件
    for (const item of items) {
      const sourcePath = path.join(source, item);
      const targetPath = path.join(target, item);
      
      // 应用过滤器
      if (filter && !filter(sourcePath)) {
        continue;
      }

      const stat = fs.statSync(sourcePath);

      if (stat.isFile()) {
        // 确保目标目录存在（懒创建）
        if (!hasValidContent) {
          if (!fs.existsSync(target)) {
            fs.mkdirSync(target, { recursive: true });
          }
          hasValidContent = true;
        }
        
        // 复制文件
        fs.copyFileSync(sourcePath, targetPath);
      }
    }

    // 第二遍：递归处理子目录
    for (const item of items) {
      const sourcePath = path.join(source, item);
      const targetPath = path.join(target, item);
      
      // 应用过滤器
      if (filter && !filter(sourcePath)) {
        continue;
      }

      const stat = fs.statSync(sourcePath);

      if (stat.isDirectory()) {
        // 递归复制子目录
        const subDirHasContent = await this.copyDirectory(sourcePath, targetPath, filter);
        
        // 如果子目录有内容，标记当前目录也有内容
        if (subDirHasContent) {
          hasValidContent = true;
        }
      }
    }

    // 如果没有任何有效内容且目录已创建，则删除空目录
    if (!hasValidContent && fs.existsSync(target)) {
      try {
        // 检查目录是否真的为空
        const targetItems = fs.readdirSync(target);
        if (targetItems.length === 0) {
          fs.rmdirSync(target);
          
          // 标准化路径用于日志显示
          const normalizedPath = target.replace(/\\/g, '/');
          if (normalizedPath.includes('layout/components/')) {
            console.log(chalk.gray(`    🗑️ 移除空目录 ${path.relative(this.themeRoot, target)}`));
          }
        }
      } catch (error) {
        // 删除失败时忽略，可能目录不为空或有其他问题
      }
    }

    return hasValidContent;
  }
}

module.exports = async function(args) {
  // 解析可选的主题名称参数
  // args._ 格式为: ["theme-export", "主题名称"] 或者只有 ["theme-export"]
  let customThemeName = null;
  
  if (args._ && args._.length > 1) {
    // 主题名称在第二个位置（index 1）
    customThemeName = args._[1];
  }
  
  if (customThemeName) {
    console.log(chalk.blue(`\n🎯 导出指定主题: ${customThemeName}`));
  } else {
    console.log(chalk.blue(`\n🎯 导出默认主题`));
  }
  
  const exporter = new ThemeExporter(this, customThemeName);
  await exporter.export();
}; 