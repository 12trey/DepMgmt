import { useState, useEffect } from 'react'
import reactLogo from './assets/react.svg'
import viteLogo from './assets/vite.svg'
import heroImg from './assets/hero.png'
import './App.css'


function App() {
  const [playResults, setPlayResults] = useState(null);

  const [taskResult, setTaskResult] = useState("No data yet");
  const [files, setFiles] = useState(null);
  const [cwd, setCwd] = useState("/");
  const [parentFolder, setParentFolder] = useState("/");

  const [iniContent, setIniContent] = useState("");
  const [yamlContent, setYamlContent] = useState("");

  const [selectedIni, setSelectedIni] = useState("");
  const [selectedYaml, setSelectedYaml] = useState("");

  async function SendTask() {
    let elem = document.getElementById("taskoutput");
    let isRunning = await GetIsRunning();
    if (isRunning) {
      alert("A playbook is already running. Please wait for it to finish before starting a new one.");
      return;
    }
    console.log("Sending task...");
    setTaskResult("");
    const response = await fetch('http://localhost:7000/runplay', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream'
      },
      body: JSON.stringify({ ini: selectedIni, yaml: selectedYaml })
    });
    // .then(response => response.json())
    // .then(data => {
    //   console.log(data)
    //   setTaskResult(data);
    //   //alert(data);
    // }).catch(error => {
    //   console.error('Error fetching data:', error);
    // });
    const reader = response.body.getReader();
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      var text = new TextDecoder().decode(value);
      console.log(`Received chunk: ${text}`);
      //var data = text.substring(5).trim() + "\n"; // Remove "data: " prefix and trim whitespace
      setTaskResult(prev => `${prev}${text}`);
      setTimeout(() => {
        elem.scrollTo({
          top: elem.scrollHeight + 20,
          behavior: 'smooth' // Optional
        });
      }, 100);

      if (`${text}`.startsWith("Process exited with code 0")) {
        setTimeout(() => {
          elem.scrollTo({
            top: elem.scrollHeight + 20,
            behavior: 'smooth' // Optional
          });
        }, 100);
        let trimmed = text.substring("Process exited with code 0".length).trim();
        console.log(JSON.parse(trimmed));
        //setTaskResult(prev => `${JSON.stringify(JSON.parse(trimmed), null, 4)}`);
        setPlayResults(JSON.parse(trimmed));
        console.log(playResults);
        alert("Playbook execution completed!");
      }
    }
  }

  async function GetIsRunning() {
    const response = await fetch('http://localhost:7000/isrunning');
    const data = await response.json();
    console.log(`Is playbook running? ${data.isRunning}`);
    return data.isRunning;
  }

  function getFiles() {
    console.log(`Getting files... ${arguments.length > 0 ? `Folder: ${arguments[0]}` : ""}`);
    let fldr = arguments.length && arguments[0].trim().length > 1 ? `/${arguments[0]}` : "/";
    fetch('http://localhost:7000/files', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ folder: fldr })
    })
      .then(response => response.json())
      .then(data => {
        setFiles(data);
        setCwd(data.cwd);
        console.log("********")
        //console.log(data.cwd.split('/').slice(0, -1).join('/'))
        let pfldr = "/" + data.cwd.split('/').filter(Boolean).slice(0, -1).join('/');
        //pfldr = pfldr === "./." ? "." : pfldr;
        //console.log(`Parent folder: ${pfldr}`);
        setParentFolder(pfldr);
      }).catch(error => {
        console.error('Error fetching data:', error);
      });
  }

  useEffect(() => {
    getFiles();
  }, []);

  function checkItem(filepath) {
    //alert(`Clicked on: ${e.target.innerText}`);
    // var isIni = e.target.innerText.endsWith('.ini');
    // var isYaml = e.target.innerText.endsWith('.yaml') || e.target.innerText.endsWith('.yml');

    var e = filepath.split('/').pop();
    var isIni = e.endsWith('.ini');
    var isYaml = e.endsWith('.yaml') || e.endsWith('.yml');

    fetch('http://localhost:7000/getfilecontent', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ file: `${cwd}/${e}` })
    })
      .then(response => response.json())
      .then(data => {
        //console.log(data)
        //alert(data.content);
        if (isIni) {
          selectedIni === `${cwd}${e}` ? setSelectedIni("") : setSelectedIni(`${cwd}/${e}`);
          setIniContent(data.content);
          // setIniContent(`${cwd}${e}`);
        } else if (isYaml) {
          selectedYaml === `${cwd}${e}` ? setSelectedYaml("") : setSelectedYaml(`${cwd}/${e}`);
          setYamlContent(data.content);
          // setYamlContent(`${cwd}${e.target.innerText}`);
        }
      }).catch(error => {
        console.error('Error fetching data:', error);
      });
  }

  const [count, setCount] = useState(0)

  return (
    <>
      <section id="filebrowser">
        <div className="filebrowser" style={{ textAlign: "left" }}>
          <div>Current directory: <span title={cwd}>{cwd}</span></div>
          {parentFolder != cwd ? <div className="fileName" onClick={(e) => getFiles(parentFolder)} title='Previous folder'>↖️ {(parentFolder)}</div> : ""}
          <div>
            {files && files.folders ? <div>{files.folders.map((item, index) => (<div key={index} className="fileName" title={item.split('/').pop()} onClick={(e) => getFiles(item)}>📁 {item.split('/').pop()}</div>))}</div> : <p>Loading folders...</p>}
          </div>
          {files && files.files ? <div>{files.files.map((item, index) => (<div key={index} className="fileName" title={item.split('/').pop()} onClick={(e) => checkItem(item)}>📄 {item.split('/').pop()}</div>))}</div> : <p>Loading files...</p>}
        </div>
      </section>
      <section id="center">
        {/* <div className="hero">
          <img src={heroImg} className="base" width="170" height="179" alt="" />
          <img src={reactLogo} className="framework" alt="React logo" />
          <img src={viteLogo} className="vite" alt="Vite logo" />
        </div> */}

        <div style={{ margin: "20px" }} className="subpanel">
          <div>Selected host path: {selectedIni}</div>
          <h4 className='headerbase'>.ini file contents</h4>
          <div className="acceptini" style={{ textAlign: "left", maxHeight: "200px", overflow: "auto", font: "12px monospace" }}>
            <pre id="iniContent">
              {iniContent}
            </pre>
          </div>
        </div>

        <div style={{ margin: "20px" }} className="subpanel">
          <div>Selected playbook path: {selectedYaml}</div>
          <h4 className='headerbase'>.yaml file contents</h4>
          <div className="acceptyaml" style={{ textAlign: "left", maxHeight: "200px", overflow: "auto", font: "12px monospace" }}>
            <pre id="yamlContent">
              {yamlContent}
            </pre>
          </div>
        </div>

        <hr style={{ margin: "20px", backgroundColor: "#252525" }} />

        <div>
          <h3>Ansible playbook results</h3>
          {/* <p>
            Edit <code>src/App.jsx</code> and save to test <code>HMR</code>
          </p> */}
          <div>Playbook path: {selectedYaml}</div>
          <div>Host path: {selectedIni}</div>
          <button
            className="counter"
            onClick={() => { setCount((count) => count + 1); SendTask(); }}
          >
            Run playbook
          </button>
          <div id="taskoutput" className="subpanel" style={{ maxHeight: "400px", margin: "20px" }}>
            <div style={{ textAlign: "left" }}>
              <h4>Task output:</h4>
              {/* {typeof (taskResult.msg) === 'string' ? taskResult.msg : (taskResult.msg.plays !== undefined ? Object.entries(taskResult.msg.plays).map(([key, value]) => (
                value.tasks ? Object.entries(value.tasks).map(([taskKey, taskValue]) => (
                  (taskValue.hosts ? Object.entries(taskValue.hosts).map(([hostKey, hostValue]) => (
                    <div style={{ fontSize: "14px", margin: "10px" }} key={`${key}-${taskKey}-${hostKey}`}>
                      <h4>Task: {taskValue.task.name}</h4>
                      <h4>Host: {hostKey}</h4>
                      <h4>Start: {taskValue.task.duration.start}</h4>
                      <h4>End: {taskValue.task.duration.end}</h4>
                      <hr style={{ margin: "20px", backgroundColor: "#252525" }} />
                      <pre>{hostValue.stdout}</pre>
                    </div>
                  )) : "")
                )) : ""
              )) : "")} */}
              <div style={{ font: "12px monospace", margin: "10px" }}>
                {typeof (taskResult) === 'string' ? <pre>{taskResult}</pre> : JSON.stringify(taskResult)}
              </div>
            </div>
          </div>

          <div className="subpanel" style={{ maxHeight: "400px", margin: "20px" }}>
            <div style={{ textAlign: "left" }}>
              <h4>Play output:</h4>
              {
                typeof (playResults) === 'object' && playResults != null ?
                  Object.entries(playResults.msg.plays).map(([key, value]) => (
                    value.tasks ? Object.entries(value.tasks).map(([taskKey, taskValue]) => (
                      (taskValue.hosts ? Object.entries(taskValue.hosts).map(([hostKey, hostValue]) => (
                        <div style={{ font: "14px Segoe UI", margin: "10px" }} key={`${key}-${taskKey}-${hostKey}`}>
                          <h4>Task: {taskValue.task.name}</h4>
                          <h4>Host: {hostKey}</h4>
                          <h4>Start: {taskValue.task.duration.start}</h4>
                          <h4>End: {taskValue.task.duration.end}</h4>
                          <hr style={{ margin: "20px", backgroundColor: "#252525" }} />
                          <pre>{hostValue.stdout}</pre>
                        </div>
                      )) : "")
                    )) : ""
                  )) : ""
              }
            </div>
          </div>

        </div>
      </section>


      {/* <div className="ticks"></div>

      <section id="next-steps">
        <div id="docs">
          <svg className="icon" role="presentation" aria-hidden="true">
            <use href="/icons.svg#documentation-icon"></use>
          </svg>
          <h2>Documentation</h2>
          <p>Your questions, answered</p>
          <ul>
            <li>
              <a href="https://vite.dev/" target="_blank">
                <img className="logo" src={viteLogo} alt="" />
                Explore Vite
              </a>
            </li>
            <li>
              <a href="https://react.dev/" target="_blank">
                <img className="button-icon" src={reactLogo} alt="" />
                Learn more
              </a>
            </li>
          </ul>
        </div>
        <div id="social">
          <svg className="icon" role="presentation" aria-hidden="true">
            <use href="/icons.svg#social-icon"></use>
          </svg>
          <h2>Connect with us</h2>
          <p>Join the Vite community</p>
          <ul>
            <li>
              <a href="https://github.com/vitejs/vite" target="_blank">
                <svg
                  className="button-icon"
                  role="presentation"
                  aria-hidden="true"
                >
                  <use href="/icons.svg#github-icon"></use>
                </svg>
                GitHub
              </a>
            </li>
            <li>
              <a href="https://chat.vite.dev/" target="_blank">
                <svg
                  className="button-icon"
                  role="presentation"
                  aria-hidden="true"
                >
                  <use href="/icons.svg#discord-icon"></use>
                </svg>
                Discord
              </a>
            </li>
            <li>
              <a href="https://x.com/vite_js" target="_blank">
                <svg
                  className="button-icon"
                  role="presentation"
                  aria-hidden="true"
                >
                  <use href="/icons.svg#x-icon"></use>
                </svg>
                X.com
              </a>
            </li>
            <li>
              <a href="https://bsky.app/profile/vite.dev" target="_blank">
                <svg
                  className="button-icon"
                  role="presentation"
                  aria-hidden="true"
                >
                  <use href="/icons.svg#bluesky-icon"></use>
                </svg>
                Bluesky
              </a>
            </li>
          </ul>
        </div>
      </section>

      <div className="ticks"></div>
      <section id="spacer"></section> */}
    </>
  )
}

export default App
