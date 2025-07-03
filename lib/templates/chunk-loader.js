// Hexo Theme Component Chunk Loader
(function() {
  const loadedChunks = new Set();
  const loadingPromises = new Map();

  // 加载单个脚本
  function loadScript(src) {
    if (loadingPromises.has(src)) {
      return loadingPromises.get(src);
    }

    const promise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.async = true;

      script.onload = () => {
        loadedChunks.add(src);
        loadingPromises.delete(src);
        resolve();
      };

      script.onerror = () => {
        loadingPromises.delete(src);
        reject(new Error(`Failed to load script: ${src}`));
      };

      document.head.appendChild(script);
    });

    loadingPromises.set(src, promise);
    return promise;
  }

  // 并行加载所有块
  window.loadComponentChunks = async function() {
    try {
      const response = await fetch('/js/components.manifest.json');
      const manifest = await response.json();
      
      // 并行加载所有块
      const loadPromises = manifest.bundles.map(bundle => 
        loadScript(`/js/${bundle.file}`)
      );

      await Promise.all(loadPromises);
      console.log('All component chunks loaded successfully');
    } catch (error) {
      console.error('Error loading component chunks:', error);
    }
  };

  // 在DOMContentLoaded时自动加载
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', window.loadComponentChunks);
  } else {
    window.loadComponentChunks();
  }
})(); 