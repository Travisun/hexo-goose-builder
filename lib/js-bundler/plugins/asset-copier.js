const path = require('path');
const fs = require('fs-extra');
const postcss = require('postcss');
const ProgressLogger = require('../../progress-logger');

/**
 * 资源复制插件配置接口
 * @typedef {Object} AssetCopierOptions
 * @property {string} assetsPath - 资源输出目录
 * @property {boolean} useHash - 是否使用哈希值
 * @property {Object} hashOptions - 哈希选项
 * @property {boolean} hashOptions.append - 是否在文件名后附加哈希
 * @property {string} hashOptions.method - 哈希算法
 * @property {string} [publicPath] - 资源的公共访问路径（例如：'/css/assets'）
 * @property {boolean} [cleanBeforeBuild] - 是否在构建前清理 assets 目录，默认为 true
 * @property {Object} [hexoConfig] - Hexo配置对象，用于获取调试设置
 */

/**
 * 格式化文件大小
 * @param {number} bytes 
 * @returns {string}
 */
function formatFileSize(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}



/**
 * 简单的单行进度显示
 * @param {number} current 当前进度
 * @param {number} total 总数
 * @param {string} message 消息
 */
function showSimpleProgress(current, total, message = '') {
  if (total === 0) return;
  
  const percent = Math.round((current / total) * 100);
  const barLength = 30;
  const filledLength = Math.round((barLength * current) / total);
  const bar = '█'.repeat(filledLength) + '░'.repeat(barLength - filledLength);
  
  const progressText = `[Asset Copier] [${bar}] ${percent}% (${current}/${total}) ${message}`;
  
  // 使用 \r 回到行首覆盖之前的内容
  process.stdout.write('\r' + progressText);
  
  // 如果完成了，换行
  if (current === total) {
    process.stdout.write('\n');
  }
}

/**
 * 创建日志函数
 * @param {boolean} debug - 是否开启调试模式
 * @returns {Object} 日志函数对象
 */
function createLogger(debug = false) {
  if (debug) {
    // 调试模式：使用完整日志
    return {
      log: console.log,
      warn: console.warn,
      error: console.error,
      progressLogger: null,
      simpleProgress: showSimpleProgress,
      isDebug: true
    };
  } else {
    // 非调试模式：使用进度条和滚动日志
    const progressLogger = new ProgressLogger('Asset Copier');
    return {
      log: (message) => {
        // 在非调试模式下简化日志记录
        // 只记录重要信息，不显示详细的文件处理信息
      },
      warn: (message) => {
        // 警告信息仍然记录
        console.warn(message);
      },
      error: (message) => {
        // 错误信息仍然记录
        console.error(message);
      },
      progressLogger,
      simpleProgress: showSimpleProgress,
      isDebug: false
    };
  }
}

/**
 * 清理目录
 * @param {string} dir 要清理的目录
 * @param {Object} logger 日志对象
 * @returns {Promise<void>}
 */
async function cleanDirectory(dir, logger) {
  try {
    // 检查目录是否存在
    if (await fs.pathExists(dir)) {
      // 获取目录信息
      const stats = await fs.stat(dir);
      if (!stats.isDirectory()) {
        throw new Error(`路径 ${dir} 不是一个目录`);
      }

      // 读取目录内容
      const files = await fs.readdir(dir);
      logger.log(`[Asset Copier] 清理目录 ${dir}`);
      if (files.length > 0) {
        logger.log(`[Asset Copier] 发现 ${files.length} 个文件/目录待清理`);
      }

      // 删除所有文件和子目录
      if (files.length > 0) {
        await Promise.all(files.map(async file => {
          const fullPath = path.join(dir, file);
          await fs.remove(fullPath);
          // 只在debug模式下显示每个删除的文件
          if (logger.isDebug) {
            logger.log(`[Asset Copier] 已删除: ${fullPath}`);
          }
        }));
      }

      logger.log(`[Asset Copier] 目录清理完成: ${dir}`);
    } else {
      // 如果目录不存在，创建它
      await fs.ensureDir(dir);
      logger.log(`[Asset Copier] 创建目录: ${dir}`);
    }
  } catch (error) {
    logger.error(`[Asset Copier] ❌ 清理目录失败: ${error.message}`);
    throw error;
  }
}

/**
 * 从CSS内容中提取资源路径
 * @param {string} content - CSS内容
 * @returns {string[]} - 资源路径数组
 */
function extractAssetPaths(content) {
  const patterns = [
    // 标准 url() 格式，支持单引号、双引号或无引号
    /url\(['"]?([^'"()]+?)['"]?\)/g,
    
    // 字体文件格式，支持 src: url() 和 src: local()
    /src:\s*url\(['"]?([^'"()]+?)['"]?\)/g,
    
    // 字体本地字体引用（local函数）
    /src:\s*local\(['"]?([^'"()]+?)['"]?\)/g,
    
    // 其他可能的资源引用格式
    /content:\s*url\(['"]?([^'"()]+?)['"]?\)/g,
    /list-style-image:\s*url\(['"]?([^'"()]+?)['"]?\)/g,
    /cursor:\s*url\(['"]?([^'"()]+?)['"]?\)/g,
    /mask(?:-image)?:\s*url\(['"]?([^'"()]+?)['"]?\)/g,
    /-webkit-mask(?:-image)?:\s*url\(['"]?([^'"()]+?)['"]?\)/g,
    /filter:\s*url\(['"]?([^'"()]+?)['"]?\)/g
  ];

  const assets = new Set();
  
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(content)) !== null) {
      // 获取第一个捕获组的值
      const assetPath = match[1];
      
      // 确保路径存在且不为空
      if (assetPath && assetPath.trim()) {
        // 跳过数据URL、绝对URL和CSS关键字
        if (!assetPath.startsWith('data:') && 
            !assetPath.startsWith('http://') && 
            !assetPath.startsWith('https://') &&
            !assetPath.startsWith('//') &&
            !isCSSkeyword(assetPath.trim())) {
          assets.add(assetPath.trim());
        }
      }
    }
  }

  return Array.from(assets);
}

/**
 * 检查是否为CSS关键字（不需要处理的值）
 * @param {string} value - 要检查的值
 * @returns {boolean} - 是否为CSS关键字
 */
function isCSSkeyword(value) {
  const keywords = [
    'none', 'initial', 'inherit', 'unset', 'revert', 'auto',
    'transparent', 'currentColor', 'inherit',
    // 颜色关键字
    'black', 'white', 'red', 'green', 'blue', 'yellow', 'orange', 'purple',
    // 渐变函数
    'linear-gradient', 'radial-gradient', 'conic-gradient',
    'repeating-linear-gradient', 'repeating-radial-gradient'
  ];
  
  // 检查是否为关键字
  if (keywords.includes(value.toLowerCase())) {
    return true;
  }
  
  // 检查是否为函数调用（如gradient函数等）
  if (/^[a-zA-Z-]+\s*\(/.test(value)) {
    return true;
  }
  
  // 检查是否为颜色值
  if (/^#[0-9a-fA-F]{3,8}$/.test(value) || 
      /^rgb\s*\(/.test(value) || 
      /^rgba\s*\(/.test(value) ||
      /^hsl\s*\(/.test(value) ||
      /^hsla\s*\(/.test(value)) {
    return true;
  }
  
  return false;
}

/**
 * 创建 PostCSS 资源复制插件
 * @param {AssetCopierOptions} opts 
 */
module.exports = (opts = {}) => {
  const options = {
    assetsPath: './assets',
    useHash: true,
    hashOptions: {
      append: true,
      method: 'sha256'
    },
    publicPath: '/css/assets', // 默认公共访问路径
    cleanBeforeBuild: true, // 默认在构建前清理目录
    hexoConfig: null, // Hexo配置对象
    ...opts
  };

  // 检查是否开启调试模式
  const isDebugMode = options.hexoConfig &&
                     options.hexoConfig.theme_builder && 
                     options.hexoConfig.theme_builder.debug === true;

  // 创建日志对象
  const logger = createLogger(isDebugMode);

  // 用于跟踪是否已经清理过目录
  let hasCleanedDir = false;

  return {
    postcssPlugin: 'postcss-asset-copier',
    async Once(root, { result }) {
      const from = result.opts.from;
      if (!from) {
        logger.warn('[Asset Copier] 没有提供源文件路径，跳过资源复制');
        return;
      }

      // 确保目标目录存在并清理
      const targetDir = path.resolve(process.cwd(), options.assetsPath);
      if (options.cleanBeforeBuild && !hasCleanedDir) {
        await cleanDirectory(targetDir, logger);
        hasCleanedDir = true;
      }

      const assets = extractAssetPaths(root.toString());
      let totalAssets = assets.length;
      let successCount = 0;
      let failCount = 0;

      // 只在有资源时显示详细信息，或在调试模式下显示
      if (totalAssets > 0 || logger.isDebug) {
        logger.log('\n[Asset Copier] ====== 开始处理文件 ======');
        logger.log(`[Asset Copier] 源文件: ${from}`);
        logger.log(`[Asset Copier] 输出目录: ${options.assetsPath}`);
        logger.log(`[Asset Copier] 公共访问路径: ${options.publicPath}`);
        logger.log(`[Asset Copier] 哈希模式: ${options.useHash ? '启用' : '禁用'}`);
        logger.log(`[Asset Copier] 检测到 ${totalAssets} 个资源引用`);
      }

      // 只在有资源时才显示进度条
      if (totalAssets > 0) {
        // 初始化进度条
        if (logger.progressLogger) {
          logger.progressLogger.setTotal(totalAssets);
          logger.progressLogger.updateProgress(0, `开始处理 ${totalAssets} 个资源`);
        } else if (!logger.isDebug) {
          // 使用简单进度条作为备选
          logger.simpleProgress(0, totalAssets, '开始处理...');
        }
      }

      // 处理所有资源 - 使用串行处理以便更好地显示进度
      for (let index = 0; index < assets.length; index++) {
        const assetPath = assets[index];
        try {
          const sourcePath = path.resolve(path.dirname(from), assetPath);
          logger.log(`\n[Asset Copier] 处理资源 [${index + 1}/${totalAssets}]: ${assetPath}`);
          logger.log(`[Asset Copier] 源路径: ${sourcePath}`);
          
          // 更新进度条 - 确保只在有资源时更新
          if (logger.progressLogger && totalAssets > 0) {
            logger.progressLogger.updateProgress(index + 1, `处理中: ${path.basename(assetPath)}`);
          } else if (!logger.isDebug && totalAssets > 0) {
            logger.simpleProgress(index + 1, totalAssets, `处理中: ${path.basename(assetPath)}`);
          }
          
          // 检查源文件是否存在
          if (!await fs.pathExists(sourcePath)) {
            logger.warn(`[Asset Copier] ❌ 资源未找到: ${sourcePath}`);
            failCount++;
            
            // 更新进度条状态
            if (logger.progressLogger && totalAssets > 0) {
              logger.progressLogger.updateProgress(index + 1, `❌ ${path.basename(assetPath)} - 未找到`);
            } else if (!logger.isDebug && totalAssets > 0) {
              logger.simpleProgress(index + 1, totalAssets, `❌ ${path.basename(assetPath)} - 未找到`);
            }
            continue;
          }

          // 获取文件信息
          const stats = await fs.stat(sourcePath);
          logger.log(`[Asset Copier] 文件大小: ${formatFileSize(stats.size)}`);

          // 生成目标路径
          const fileName = path.basename(assetPath);
          let targetFileName = fileName;

          // 如果启用哈希，生成文件哈希
          if (options.useHash) {
            const fileContent = await fs.readFile(sourcePath);
            const hash = require('crypto')
              .createHash(options.hashOptions.method)
              .update(fileContent)
              .digest('hex')
              .slice(0, 8);

            logger.log(`[Asset Copier] 生成的哈希值: ${hash}`);

            const ext = path.extname(fileName);
            const nameWithoutExt = path.basename(fileName, ext);
            targetFileName = `${nameWithoutExt}${options.hashOptions.append ? '.' + hash : ''}${ext}`;
          }

          const targetPath = path.join(targetDir, targetFileName);

          // 复制文件
          await fs.copy(sourcePath, targetPath);

          // 生成公共访问路径
          const publicPath = path.posix.join(options.publicPath, targetFileName);

          // 遍历所有声明，更新资源路径
          root.walkDecls(decl => {
            if (decl.value.includes(assetPath)) {
              const escapedPath = assetPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
              const replaceRegex = new RegExp(`(url\\(['"]?)${escapedPath}(['"]?\\))`, 'g');
              decl.value = decl.value.replace(replaceRegex, `$1${publicPath}$2`);
            }
          });

          logger.log(`[Asset Copier] ✅ 复制成功`);
          logger.log(`[Asset Copier] 目标路径: ${targetPath}`);
          logger.log(`[Asset Copier] CSS中的引用路径: ${publicPath}`);
          successCount++;

          // 更新进度条状态
          if (logger.progressLogger && totalAssets > 0) {
            logger.progressLogger.updateProgress(index + 1, `✅ ${path.basename(assetPath)} (${formatFileSize(stats.size)})`);
          } else if (!logger.isDebug && totalAssets > 0) {
            logger.simpleProgress(index + 1, totalAssets, `✅ ${path.basename(assetPath)} (${formatFileSize(stats.size)})`);
          }
        } catch (error) {
          logger.error(`[Asset Copier] ❌ 处理失败 ${assetPath}:`, error);
          failCount++;
          
          // 更新进度条状态
          if (logger.progressLogger && totalAssets > 0) {
            logger.progressLogger.updateProgress(index + 1, `❌ ${path.basename(assetPath)} - 处理失败`);
          } else if (!logger.isDebug && totalAssets > 0) {
            logger.simpleProgress(index + 1, totalAssets, `❌ ${path.basename(assetPath)} - 处理失败`);
          }
        }
      }

      // 完成处理
      if (logger.progressLogger && totalAssets > 0) {
        // 确保最终进度显示为100%
        logger.progressLogger.current = logger.progressLogger.total;
        logger.progressLogger.lastUpdateTime = 0; // 强制更新
        logger.progressLogger.updateProgress(totalAssets, `处理完成`);
        
        // 短暂暂停让用户看到100%状态
        await new Promise(resolve => setTimeout(resolve, 100));
        
        logger.progressLogger.complete(successCount, failCount, totalAssets);
      } else if (!logger.isDebug && totalAssets > 0) {
        // 使用简单进度条完成
        logger.simpleProgress(totalAssets, totalAssets, '处理完成');
        console.log(`✅ [Asset Copier] 处理完成: ${successCount}/${totalAssets} 成功 (${Math.round(successCount/totalAssets*100)}%)`);
      } else {
        // 调试模式或无资源时的简洁输出
        if (totalAssets === 0) {
          logger.log('[Asset Copier] 无需处理的资源');
        } else {
          logger.log('\n[Asset Copier] ====== 处理完成 ======');
          logger.log(`[Asset Copier] 总资源数: ${totalAssets}`);
          logger.log(`[Asset Copier] 成功: ${successCount}`);
          logger.log(`[Asset Copier] 失败: ${failCount}`);
          logger.log('[Asset Copier] ========================\n');
        }
      }
    }
  };
};

module.exports.postcss = true;