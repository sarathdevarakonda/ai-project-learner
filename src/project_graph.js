import fs from 'fs';
import path from 'path';
import Graph from 'graphology';
import crypto from 'crypto';


function topsort(g) {
  const sorted = [];
  const visited = new Set();
  const temp = new Set();

  function visit(node) {
    if (visited.has(node)) return;
    if (temp.has(node)) throw new Error('Graph has a cycle');

    temp.add(node);

    for (const neighbor of g.neighbors(node)) {
      visit(neighbor);
    }

    temp.delete(node);
    visited.add(node);
    sorted.unshift(node);
  }

  for (const node of g.nodes()) {
    visit(node);
  }

  return sorted;
}

function createNodeId(projectName, packageName, version) {
  const input = `${projectName}/${packageName}@${version}`;
  const hash = crypto.createHash('sha256').update(input).digest('hex');
  return hash;
}

function findPackageJsonFiles(dir) {
  let packageJsonFiles = [];
  const files = fs.readdirSync(dir, { withFileTypes: true });
  for (const file of files) {
    const filePath = path.join(dir, file.name);
    if (file.isDirectory() && file.name !== 'node_modules') {
      packageJsonFiles = packageJsonFiles.concat(findPackageJsonFiles(filePath));
    } else if (file.name === 'package.json') {
      packageJsonFiles.push(filePath);
    }
  }
  return packageJsonFiles;
}


async function createPackageDependencyGraph(projectDir) {
  const g = new Graph({ type: 'directed' });
 
  const packageJsonFiles = findPackageJsonFiles(projectDir);

  for (const packageJsonFile of packageJsonFiles) {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonFile, 'utf-8'));
    const packageName = packageJson.name;
    const packageDir = path.dirname(packageJsonFile);
    const version = "^" + packageJson.version;

    // Create a node for the package
    const nodeId = createNodeId(path.basename(projectDir), packageName,version);
    const directory = path.relative(projectDir, packageDir)
    g.addNode(nodeId, {
      label: 'Package',
      directory: directory || ".",
      packageName,
      version
    });

    // Create relationships for dependencies
    if (packageJson.dependencies) {
      for (const dependency in packageJson.dependencies) {
        const dependencyVersion = packageJson.dependencies[dependency];
        const dependencyNodeId = createNodeId(path.basename(projectDir), dependency, dependencyVersion);
        
        if (!g.hasNode(dependencyNodeId)) {
          g.addNode(dependencyNodeId, {
            label: 'Package',
            external: true,
            version: dependencyVersion
          });
        }

        g.addEdge(nodeId, dependencyNodeId, { type: 'DEPENDS_ON' });
      }
    }
  }

  return g;
}


function createFileDependency(packageNode) {
  const g = new Graph();

  const packageDir = path.join(projectDir, packageNode.directory);
  const jsFiles = [];

  const traverseDir = (dir) => {
    const files = fs.readdirSync(dir, { withFileTypes: true });
    for (const file of files) {
      const filePath = path.join(dir, file.name);
      if (file.isDirectory() && file.name !== 'node_modules') {
        traverseDir(filePath);
      } else if (file.isFile() && (file.name.endsWith('.js') || file.name.endsWith('.jsx'))) {
        jsFiles.push(filePath);
      }
    }
  };

  traverseDir(packageDir);

  for (const jsFile of jsFiles) {
    const code = fs.readFileSync(jsFile, 'utf-8');
    const ast = parse(code, { sourceType: 'module', plugins: ['jsx'] });

    const dependencies = [];
    const getDependencies = (node) => {
      if (node.type === 'ImportDeclaration') {
        const moduleName = node.source.value;
        dependencies.push(moduleName);
      } else if (node.type === 'CallExpression' && node.callee.name === 'require') {
        const moduleName = node.arguments[0].value;
        dependencies.push(moduleName);
      }
    };

    traverse(ast, getDependencies);

    const fileNodeId = createFileNodeId(packageDir, jsFile);
    g.addNode(fileNodeId, { label: 'File', filePath: path.relative(projectDir, jsFile) });

    for (const dependency of dependencies) {
      if (dependency.startsWith('.') || dependency.startsWith('..')) {
        const resolvedPath = resolve.sync(dependency, { basedir: path.dirname(jsFile) });
        const dependencyNodeId = createFileNodeId(packageDir, resolvedPath);
        if (!g.hasNode(dependencyNodeId)) {
          g.addNode(dependencyNodeId, { label: 'File', filePath: path.relative(projectDir, resolvedPath) });
        }
        g.addEdge(fileNodeId, dependencyNodeId, { type: 'IMPORTS' });
      } else {
        const dependencyNodeId = createFileNodeId(packageDir, path.join(packageDir, 'node_modules', dependency));
        if (!g.hasNode(dependencyNodeId)) {
          g.addNode(dependencyNodeId, { label: 'File' });
        }
        g.addEdge(fileNodeId, dependencyNodeId, { type: 'IMPORTS' });
      }
    }
  }
  return g;
}



async function createProjectGraph(projectDir) {
  const packageDependencyGraph = await createPackageDependencyGraph(projectDir);
  const nodes1 = packageDependencyGraph.nodes().map(nodeId => ({
    nodeId,
    ...packageDependencyGraph.getNodeAttributes(nodeId),
  }));
  fs.writeFileSync("node1.json", JSON.stringify(nodes1))
  const sortedNodes = topsort(packageDependencyGraph);

  for (const nodeId of sortedNodes) {
    const node = packageDependencyGraph.getNodeAttributes(nodeId);
    if (node.label === 'Package' && node.directory && !node.external) {
      const fileDependencyGraph = createFileDependency(node);
      
    }
  }

  console.log(packageDependencyGraph);
  const nodes = packageDependencyGraph.nodes().map(nodeId => ({
    nodeId,
    ...packageDependencyGraph.getNodeAttributes(nodeId),
  }));
  return nodes;
}


export {
  createPackageDependencyGraph,
  createProjectGraph
}


