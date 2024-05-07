const fs = require('fs-extra');
const glob = require('glob');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const path = require('path');
const babel = require('@babel/core');
const generator = require('@babel/generator').default;  // Import the generator
const { ChatGPTAutomation, ChatGPTSession } = require('./gpt_selenium')
const { transformFromAstSync } = babel
const types = require('@babel/types');
const { exec } = require('child_process');
const os = require('os')
const inputDir = './chat_application/src'; // Adjust the path to your source files
const outputFile = './chat_application/src/allCode.js';

// Helper function to parse file and extract dependencies
async function parseDependencies(filePath) {
    const code = await fs.readFile(filePath, 'utf8');
    const ast = parser.parse(code, {
        sourceType: 'module',
        plugins: ['jsx', 'typescript']
    });
    let importCode = ''
    const dependencies = [];
    traverse(ast, {
        ImportDeclaration({ node }) {
            const importValue = node.source.value;

            // Check if the import is a local file
            if (importValue.startsWith('./') || importValue.startsWith('../') || path.isAbsolute(importValue)) {
                let dependencyPath = path.resolve(path.dirname(filePath), importValue);

                // Add file extensions if they are missing
                if (!dependencyPath.endsWith('.js') && !dependencyPath.endsWith('.jsx')) {
                    dependencyPath += '.js'; // Assume .ts if no extension specified
                    if (!fs.existsSync(dependencyPath)) {
                        dependencyPath = dependencyPath.slice(0, -3) + '.jsx'; // Try .tsx if .ts doesn't exist
                    }
                }

                // Check if the file exists before adding to dependencies
                if (fs.existsSync(dependencyPath)) {
                    dependencies.push(dependencyPath);
                }
            } else {
                importCode += `${node.leadingComments ? node.leadingComments.map(comment => comment.value).join('\n') : ''}${code.substring(node.start, node.end)}\n`;

            }

        }
    });

    return { dependencies, importCode };
}

// Build the dependency graph
async function buildDependencyGraph(files) {
    const graph = new Map();
    let imports = ''
    for (const file of files) {
        const fullPath = path.resolve(file);
        const { dependencies, importCode } = await parseDependencies(fullPath);
        graph.set(fullPath, dependencies);
        imports += importCode
    }

    return { graph, imports };
}

// Function to perform topological sort on the graph
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


async function* parseFiles(imports, orderedFiles) {



    for (const file of orderedFiles) {
        const code = await fs.readFile(file, 'utf8');
        const ast = parser.parse(code, {
            sourceType: 'module',
            plugins: ['jsx', 'typescript']
        });

        let generatedCodes = []; // Array to store generated codes

        // Traverse the AST here if needed to manipulate or analyze before output
        traverse(ast, {
            enter(path) {
                if (path.node.type === 'FunctionDeclaration' || path.node.type === 'VariableDeclaration') {
                    const { code: generatedCode } = generator(path.node);
                    generatedCodes.push(generatedCode); // Collect generated codes

                }
            }
        });
        for (const generatedCode of generatedCodes) {
            yield generatedCode;
        }

    }
}

function getDirectoryNameFromGitUrl(gitUrl) {
    // Use a regular expression to extract the last part of the URL
    const regex = /\/([^\/]+?)(\.git)?$/;
    const match = gitUrl.match(regex);
    return match ? match[1] : null;
}
const args = process.argv;

async function loadConfig() {

    try {
        // Ensure the index 5 is within the bounds of args array


        const filePath = path.join(os.homedir(), args[4] ? args[4] : "prompt.json");
        const fileContents = await fs.readFile(filePath, 'utf8'); // Make sure to specify 'utf8' to get a string
        const config = JSON.parse(fileContents);
        return config;
    } catch (error) {
        console.error('Failed to load configuration:', error);
        throw error;  // Rethrow if you need to handle it further up the call stack
    }
}

async function main() {
    const repo = args[2] ? args[2] : "https://github.com/spylix/vanilla-node-server.git"
    const repo_folder = getDirectoryNameFromGitUrl(repo)
    console.log(repo_folder)
    const inputDir = path.join(os.homedir(), repo_folder)
    exec(`git clone ${repo} ${inputDir}`, (error, stdout, stderr) => {
        if (error) {
            console.error(`exec error: ${error}`);
            goThroughCode(inputDir, args[3])
            return;
        }

        goThroughCode(inputDir, args[3] ? args[3] : "Learn_React")

        // You can continue your logic here if further processing is needed
        // For example, you might want to read files or perform other operations
    });

}
async function goThroughCode(inputDir, chatName = "Learn_React") {

    const promptConfig = await loadConfig()

    console.log(promptConfig)

    const srcFiles = glob.sync(`${inputDir}/**/*.+(js|jsx)`);
    const files = srcFiles.filter(item => !item.includes("allCode"));

    const { graph, imports } = await buildDependencyGraph(files);
    console.log(imports)
    const orderedFiles = topologicalSort(graph).reverse();
    console.log(orderedFiles)
    console.log('Files in topological order:', orderedFiles);
    let cur = parseFiles(imports, orderedFiles)
    



    const gpt = new ChatGPTAutomation();
    const url = "https://chat.openai.com";
    const port = await gpt.findAvailablePort()
    console.log("port ", port)
    gpt.launchChromeWithRemoteDebugging(port, url);
    await gpt.waitForHumanVerification()

    await gpt.createDriver(port)
    const gptSession = new ChatGPTSession(gpt)
    await gpt.clickOnChatHistory(chatName)


    

    await gptSession.ask({ value: promptConfig['start'] })

    const readline = require('readline').createInterface({
        input: process.stdin,
        output: process.stdout
    });

    // Function to handle the question as a Promise
    const getAnswer = (question) => new Promise((resolve) => {
        readline.question(question, answer => {
            resolve(answer);
        });
    });
    let piece = await cur.next()
    let answer = await getAnswer("Next?")
    console.log(typeof piece.value)

    let askPrompt = await gptSession.ask({ value: piece.value })
    while (!piece.done) {
        piece = await cur.next()
        answer = await getAnswer("Next?")
        askPrompt = await gptSession.ask({ value: piece.value })
        
    }   

}

main().catch(err => console.error(err));
