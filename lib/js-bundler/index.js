 'use strict';

const BundlerConfig = require('./js-bundler/config');
const BundlerCore = require('./js-bundler/bundler-core');

class ComponentJSBundler {
  constructor(hexo) {
    this.config = new BundlerConfig(hexo);
    this.bundlerCore = new BundlerCore(this.config);
  }

  async bundle() {
    return this.bundlerCore.bundle();
  }
}

module.exports = ComponentJSBundler;