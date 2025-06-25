import React from 'react';
import './App.css';

function App() {
    console.log("Testing AI review");
  return (
    <div className="App">
      <header className="App-header">
        <h1>Welcome to Simple React App</h1>
        <p>
          This is a very simple React application created for demonstration.
        </p>
        <div className="App-features">
          <div className="feature-card">
            <h3>🚀 Fast</h3>
            <p>Built with modern React</p>
          </div>
          <div className="feature-card">
            <h3>🎨 Beautiful</h3>
            <p>Clean and modern design</p>
          </div>
          <div className="feature-card">
            <h3>📱 Responsive</h3>
            <p>Works on all devices</p>
          </div>
        </div>
        <button className="App-button" onClick={() => alert('Hello from React!')}>
          Click Me!
        </button>
      </header>
    </div>
  );
}

export default App;
