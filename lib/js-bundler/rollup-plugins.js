'use strict';

const postcss = require('rollup-plugin-postcss');
const commonjs = require('@rollup/plugin-commonjs');
const { nodeResolve } = require('@rollup/plugin-node-resolve');
const cssnano = require('cssnano');
const autoprefixer = require('autoprefixer');
const assetCopier = require('./plugins/asset-copier');

function getPlugins(config) {
  const cssAssetsPath = config.cssDir ? `${config.cssDir}/assets` : './assets';
  
  return [
    postcss({
      extract: true,
      dir: config.cssDir,
      minimize: true,
      modules: false,
      sourceMap: false,
      filter: (id) => {
        if (id.includes('/components.') || id.includes('component.bundle.')) {
          console.log('跳过处理文件:', id);
          return false;
        }
        console.log('处理文件:', id);
        return true;
      },
      plugins: [
        assetCopier({
          assetsPath: cssAssetsPath,
          publicPath: '/css/assets',
          useHash: true,
          cleanBeforeBuild: true,
          hashOptions: {
            append: true,
            method: 'sha256'
          }
        }),
        autoprefixer(),
        cssnano({
          preset: ['default', {
            discardComments: {
              removeAll: true,
            },
            normalizeWhitespace: true,
            minifySelectors: true,
            minifyFontValues: true,
            minifyGradients: true,
            minifyParams: true,
            minifyUrls: true,
            reduceInitial: true,
            reduceTransforms: true,
            svgo: true
          }]
        })
      ]
    }),
    nodeResolve({
      browser: true,
      preferBuiltins: false,
      extensions: ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.css', '.scss', '.sass', '.less']
    }),
    commonjs({
      transformMixedEsModules: true,
      exclude: [
        '**/node_modules/katex/**',
        '**/node_modules/marked/**'
      ]
    })
  ];
}

module.exports = { getPlugins };