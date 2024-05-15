const fs = require('fs-extra');
const glob = require('glob');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const path = require('path');
const generator = require('@babel/generator').default;
const { ChatGPTAutomation, ChatGPTSession } = require('./gpt_selenium');
const os = require('os');

// Helper function to parse file and extract dependencies
async function parseDependencies(filePath) {
    const code = await fs.readFile(filePath, 'utf8');
    const ast = parser.parse(code, {
        sourceType: 'module',
        plugins: ['jsx', 'typescript']
    });

    let importCode = '';
    const dependencies = [];
    traverse(ast, {
        ImportDeclaration({ node }) {
            const importValue = node.source.value;
            let dependencyPath = path.resolve(path.dirname(filePath), importValue);

            if (!importValue.startsWith('./') && !importValue.startsWith('../') && !path.isAbsolute(importValue)) {
                importCode += `${node.leadingComments ? node.leadingComments.map(comment => comment.value).join('\n') : ''}${code.substring(node.start, node.end)}\n`;
            } else {
                if (!dependencyPath.endsWith('.js') && !dependencyPath.endsWith('.jsx')) {
                    dependencyPath += '.js';
                    if (!fs.existsSync(dependencyPath)) {
                        dependencyPath = dependencyPath.slice(0, -3) + '.jsx';
                    }
                }

                if (fs.existsSync(dependencyPath)) {
                    dependencies.push(dependencyPath);
                }
            }
        }
    });

    return { dependencies, importCode };
}

// Build the dependency graph
async function buildDependencyGraph(files) {
    const graph = new Map();
    for (const file of files) {
        const fullPath = path.resolve(file);
        const { dependencies, importCode } = await parseDependencies(fullPath);
        graph.set(fullPath, dependencies);
    }
    return { graph };
}

// Perform topological sort on the graph
function topologicalSort(graph) {
    const visited = new Set();
    const stack = [];

    const visit = (node, ancestors = new Set()) => {
        if (ancestors.has(node)) {
            throw new Error('Found cyclic dependency!');
        }
        if (visited.has(node)) return;

        ancestors.add(node);
        visited.add(node);
        const edges = graph.get(node) || [];
        edges.forEach(adj => visit(adj, new Set(ancestors)));
        stack.unshift(node);
    };

    graph.forEach((_, node) => visit(node));
    return stack;
}

// Generator function to parse files
async function* parseFiles(orderedFiles) {
    for (const file of orderedFiles) {
        const code = await fs.readFile(file, 'utf8');
        const ast = parser.parse(code, {
            sourceType: 'module',
            plugins: ['jsx', 'typescript']
        });

        let generatedCodes = [];
        const imports = [];
        const declarations = [];

        traverse(ast, {
            enter(path) {
                if (path.node.type === 'Program') {
                    path.node.body.forEach(obj => {
                        const { code: generatedCode } = generator(obj.node);
                        if (obj.node.type === 'ImportDeclaration') {
                            imports.push(generatedCode);
                        } else {
                            declarations.push(generatedCode);
                        }
                    });
                }
            }
        });

        generatedCodes.push(imports.join("\n"));
        generatedCodes.push(...declarations);
        for (const generatedCode of generatedCodes) {
            yield generatedCode;
        }
    }
}

// Get directory name from Git URL
function getDirectoryNameFromGitUrl(gitUrl) {
    const regex = /\/([^\/]+?)(\.git)?$/;
    const match = gitUrl.match(regex);
    return match ? match[1] : null;
}

// Load configuration from file
async function loadConfig(name) {
    try {
        const filePath = path.join(os.homedir(), "learn-fast", name);
        const fileContents = await fs.readFile(filePath, 'utf8');
        const config = JSON.parse(fileContents);
        return config;
    } catch (error) {
        console.error('Failed to load configuration:', error);
        throw error;
    }
}

// Main function to process the code
async function main() {
    const repo = process.argv[2] || "https://github.com/adrianhajdin/project_chat_application/blob/master/client/src/index.js";
    const repoFolder = getDirectoryNameFromGitUrl(repo);
    const inputDir = path.join(os.homedir(), process.argv[2]);

    await goThroughCode(inputDir);
}

// Function to process the code
async function goThroughCode(inputDir) {
    const config = await loadConfig(process.argv[2]);
    const { project_folder } = config;

    const srcFiles = glob.sync(`${project_folder}/**/*.+(js|jsx)`);
    const { graph } = await buildDependencyGraph(srcFiles);
    const orderedFiles = topologicalSort(graph).reverse();
    console.log('Files in topological order:', orderedFiles);

    const cur = parseFiles(orderedFiles);
    const gpt = new ChatGPTAutomation();
    const url = "https://chat.openai.com";
    const port = await gpt.findAvailablePort();
    gpt.launchChromeWithRemoteDebugging(port, url);
    await gpt.waitForHumanVerification();

    await gpt.createDriver(port);
    const gptSession = new ChatGPTSession(gpt);

    const readline = require('readline').createInterface({
        input: process.stdin,
        output: process.stdout
    });

    const getAnswer = (question) => new Promise((resolve) => {
        readline.question(question, answer => {
            resolve(answer);
        });
    });

    const saved = JSON.parse(await fs.readFile("last_stopped.json"));
    const chatName = process.argv[3];
    const last_stopped = saved[chatName] ? saved[chatName] : 1;
    const fullOutFile = `${chatName}.js`;

    if (!fs.existsSync(fullOutFile)) {
        fs.writeFileSync(fullOutFile, "// Learning \n");
    }

    let currentCounter = 1;
    let piece;
    while (currentCounter <= last_stopped) {
        piece = await cur.next();
        currentCounter++;
    }

    let answer = await getAnswer("Next?");
    await fs.appendFile(fullOutFile, `${piece.value}\n`);
    await gptSession.ask({ value: piece.value });
    saved[chatName] = currentCounter + 1;
    await fs.writeFile("last_stopped.json", JSON.stringify(saved));

    while (!piece.done) {
        piece = await cur.next();
        answer = await getAnswer("Next?");
        await fs.appendFile(`${chatName}.js`, `${piece.value}\n`);
        await gptSession.ask({ value: piece.value });
        saved[chatName] = currentCounter + 1;
        await fs.writeFile("last_stopped.json", JSON.stringify(saved));
        currentCounter++;
    }
}

main().catch(err => console.error(err));
