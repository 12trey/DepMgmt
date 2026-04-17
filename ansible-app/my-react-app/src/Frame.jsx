import { useState } from "react";

import "./Frame.css";
import App from "./App.jsx";
import Welcome from "./Welcome.jsx";

function Frame({ children }) {
    const [view, setView] = useState("close");

    function switchView(newView) {
        setView(newView);
    }
    return (
        <>
            <div className="header">
                <span style={{ margin: "0 10px" }}>DMT Tools UI v1.0</span> /  
                <button className="headerbutton" onClick={() => switchView("app")}>Ansible</button> / 
                <button className="headerbutton" onClick={() => switchView("close")}>AVD group manager</button> / 
                <button className="headerbutton" onClick={() => switchView("close")}>Close</button> /
            </div>
            {view === "app" ? <App/> : "" }
            {view === "close" ? <Welcome/> : "" }
        </>
    )
}

export default Frame;