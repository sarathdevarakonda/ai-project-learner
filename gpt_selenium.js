require('dotenv').config();
const { Builder, By, Key } = require('selenium-webdriver');
const http = require('http');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const { Options } = require('selenium-webdriver/chrome');
const { spawn } = require('child_process');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

class ChatGPTAutomation {
  constructor() {
    

  }



  async createDriver(freePort) {
    
     this.driver = await this.setupWebdriver(freePort);
    return this.driver;
  }

  findAvailablePort() {
    return new Promise((resolve, reject) => {
      const server = http.createServer();
      server.listen(0, () => {
        const port = server.address().port;
        server.close(() => resolve(port));
      });
    });
  }

  launchChromeWithRemoteDebugging(port,url) {
    const chromeCmd = `"${process.env.CHROME_PATH}"`;
    const args = [
        `--remote-debugging-port=${port}`,
        '--user-data-dir=remote-profile',
        url
    ];

    // Spawning the Chrome process
    this.chromeProcess = spawn(chromeCmd, args, {shell: true});

    // Handling output (optional, for logging or debugging purposes)
    this.chromeProcess.stdout.on('data', (data) => {
        console.log(`stdout: ${data}`);
    });

    this.chromeProcess.stderr.on('data', (data) => {
        console.error(`stderr: ${data}`);
    });

    this.chromeProcess.on('close', (code) => {
        console.log(`Chrome process exited with code ${code}`);
    });
}

async setupWebdriver(port) {
  // Set Chrome options
  let options = new Options();
  options.addArguments("--headless");  // Enable headless mode
  options.addArguments("--disable-gpu");  // Disabling GPU hardware acceleration

  options.addArguments(`--remote-debugging-port=${port}`);
  options.addArguments(`--debuggerAddress=127.0.0.1:${port}`);
  options.set
  // Create a Chrome WebDriver with the specified options
  let driver = await new Builder()
      .forBrowser('chrome')
      .setChromeOptions(options)
      .build();
  
  return driver;
}


async sendPromptToChatGPT(prompt) {
  // JavaScript to set the input value and dispatch events
  const script = `
      var inputBox = arguments[0];
      inputBox.value = arguments[1];
      inputBox.dispatchEvent(new Event('input', { bubbles: true }));
      inputBox.dispatchEvent(new Event('change', { bubbles: true }));
  `;

  // Find the input box element
  const inputBox = await this.driver.findElement(By.xpath('//textarea[contains(@id, "prompt-textarea")]'));
  
  // Execute the script with the found element and prompt
  await this.driver.executeScript(script, inputBox, prompt);

  // Send the RETURN key to submit the input
  await inputBox.sendKeys(Key.RETURN);
}


  async returnChatGPTConversation() {
    return await this.driver.findElements(By.css('div.text-base'));
  }

  async saveConversation(fileName) {
    const directoryName = "conversations";
    if (!fs.existsSync(directoryName)) {
      fs.mkdirSync(directoryName);
    }

    const delimiter = "|^_^|";
    const chatGPTConversation = await this.returnChatGPTConversation();
    const fileStream = fs.createWriteStream(path.join(directoryName, fileName), { flags: 'a' });
    for (let i = 0; i < chatGPTConversation.length; i += 2) {
      const prompt = await chatGPTConversation[i].getText();
      const response = await chatGPTConversation[i + 1].getText();
      fileStream.write(`prompt: ${prompt}\nresponse: ${response}\n\n${delimiter}\n\n`);
    }
    fileStream.end();
  }

  async clickOnChatHistory(text) {
    try {
        // Find all links that contain the specified text
        const links = await this.driver.findElements(By.xpath(`//a[contains(., '${text}')]`));
        if (links.length > 0) {
            // Click on the first link if at least one was found
            await links[0].click();
            console.log('Clicked on the first link containing the text:', text);
        } else {
            console.log('No links found containing the text:', text);
        }
    } catch (error) {
        console.error('Error during finding and clicking the link:', error);
    }
    await sleep(1000);
}


  async returnLastResponse() {
    try {
        // Get all elements by the specified CSS selector
        const responseElements = await this.driver.findElements(By.css('div.agent-turn'));
        
        if (responseElements.length > 0) {
            const lastResponseElement = responseElements[responseElements.length - 1];
            // console.log(await lastResponseElement.getText())
            return await lastResponseElement.getText()
            try {
                // Attempt to find the element that contains the response language information
                const languageElem = await lastResponseElement.findElement(By.css('code[class*="language-"]'));

                return await languageElem.getText(); // Return the text of the language element
            } catch (error) {
                console.error('Error finding language element:', error);
                return null; // Return null if the language element is not found
            }
        }
    } catch (error) {
        console.error('Error retrieving response elements:', error);
        return null; // Return null if there is an error retrieving response elements
    }
    return null; // Return null if no response elements were found
}

  async waitForHumanVerification() {
    console.log("You need to manually complete the log-in or the human verification if required.");
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

    let exit = false;
    while (!exit) {
        const answer = await getAnswer("Enter 'y' if you have completed the log-in or the human verification, or 'n' to check again: ");
        if (answer.toLowerCase() === 'y') {
            console.log("Continuing with the automation process...");
            readline.close();
            exit = true;
        } else if (answer.toLowerCase() === 'n') {
            console.log("Waiting for you to complete the human verification...");
            await new Promise(resolve => setTimeout(resolve, 5000));  // Properly use setTimeout with await
        } else {
            console.log("Invalid input. Please enter 'y' or 'n'.");
            readline.close();
            exit = true;
        }
    }
}

  async quit() {
    console.log("Closing the browser...");
    await this.driver.close();
    await this.driver.quit();
  }
}


class ChatGPTSession {
  constructor(gpt) {
      this.messages = [];
      this.gpt = gpt;
  }

  async isAnyConv() {
      const conversation = await this.gpt.returnChatGPTConversation();
      return conversation.length > 0;
  }

  async ask(prompt) {

      await this._submitPrompt(prompt.value);
      await sleep(1000); // Wait for 1 second
      
      while (true) {
          const sendButtons = await this.gpt.driver.findElements(By.css('button[data-testid="send-button"]'));
          if (sendButtons.length > 0) {
              return await this.gpt.returnLastResponse();
          }
          await sleep(1000); // Poll every 1 second
      }
  }

  async _submitPrompt(value) {
      await this.gpt.sendPromptToChatGPT(value);
  }
}

// Example of using the class

module.exports = {
    ChatGPTAutomation,
    ChatGPTSession
};

