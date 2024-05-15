const fs = require('fs');
const path = require('path');

async function* scanProject({ projectDir, includeDirs = [], excludeDirs = [], includeExtensions = [] }) {
  const nodes = [];
  const edges = [];

  function shouldIncludeDir(dir) {
    if (excludeDirs.some(exclude => dir.includes(exclude))) {
      return false;
    }
    if (includeDirs.length === 0) {
      return true;
    }
    return includeDirs.some(include => dir.includes(include));
  }

  function shouldIncludeFile(file) {
    if (includeExtensions.length === 0) {
      return true;
    }
    const fileExtension = path.extname(file);
    return includeExtensions.includes(fileExtension);
  }

  async function scanDirectory(dir) {
    if (!shouldIncludeDir(dir)) {
      return;
    }

    const files = fs.readdirSync(dir);
    for (const file of files) {
      const filePath = path.join(dir, file);
      const stat = fs.statSync(filePath);

      if (stat.isDirectory()) {
        await scanDirectory(filePath); // Recursively scan subdirectories
      } else if (stat.isFile() && shouldIncludeFile(filePath)) {
        await processFile(filePath);
      }
    }
  }

  async function processFile(filePath) {
    const fileNode = {
      id: filePath,
      label: 'File',
      properties: {
        path: filePath,
      },
    };
    nodes.push(fileNode);
    // Additional logic for analyzing file content can be added here
  }

  await scanDirectory(projectDir);

  for (const node of nodes) {
    yield { type: 'node', data: node };
  }
  for (const edge of edges) {
    yield { type: 'edge', data: edge };
  }
}

// Example usage
(async () => {
  const options = {
    projectDir: '/path/to/your/project',
    includeDirs: ['src', 'lib'],
    excludeDirs: ['node_modules', 'test'],
    includeExtensions: ['.js', '.jsx', '.ts', '.tsx'],
  };
  
  const generator = scanProject(options);
  
  for await (const item of generator) {
    if (item.type === 'node') {
      console.log('Node:', item.data);
    } else if (item.type === 'edge') {
      console.log('Edge:', item.data);
    }
  }
})();


