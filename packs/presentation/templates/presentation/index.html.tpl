<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="dark">
  <meta http-equiv="Content-Security-Policy" content="default-src 'self' data:; connect-src 'none'; img-src 'self' data:; style-src 'self'; script-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'">
  <title>{{project.name}} presentation</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <header class="top-rail">
    <span class="project-name">{{project.name}}</span>
    <span class="session-note">{{presentation.durationMinutes}} minute story</span>
  </header>

  <main id="deck" class="deck">
    <section id="opening" class="slide slide-opening" data-slide aria-labelledby="opening-title">
      <div class="slide-copy">
        <span class="accent-rule" aria-hidden="true"></span>
        <h1 id="opening-title">{{project.name}}</h1>
        <p class="lead">{{project.purpose}}</p>
        <p class="context">Built inside a {{workflow.timeboxMinutes}} minute focus window.</p>
      </div>
      <div class="blueprint" aria-hidden="true">
        <svg viewBox="0 0 640 520" role="presentation">
          <g class="blueprint-grid">
            <path d="M40 80H600M40 200H600M40 320H600M40 440H600"></path>
            <path d="M80 40V480M240 40V480M400 40V480M560 40V480"></path>
            <circle cx="80" cy="420" r="20"></circle>
            <circle cx="520" cy="100" r="48"></circle>
          </g>
          <path class="blueprint-guide" d="M80 420H520V100"></path>
          <path class="blueprint-path" d="M80 420C260 390 430 300 520 100"></path>
          <circle class="blueprint-point" cx="520" cy="100" r="14"></circle>
        </svg>
      </div>
    </section>

    <section id="problem" class="slide" data-slide aria-labelledby="problem-title" hidden>
      <div class="slide-index" aria-hidden="true">02</div>
      <div class="slide-copy wide-copy">
        <h2 id="problem-title">Name the costly moment.</h2>
        <p class="lead">Describe the real situation before the product exists. Use one concrete observation, not a broad market claim.</p>
        <div class="proof-slot"><strong>Add verified evidence</strong><span>Interview note, observed workflow, or reproducible source.</span></div>
      </div>
    </section>

    <section id="audience" class="slide split-slide" data-slide aria-labelledby="audience-title" hidden>
      <div class="slide-index" aria-hidden="true">03</div>
      <div class="slide-copy">
        <h2 id="audience-title">Who feels it first?</h2>
        <p class="lead">Primary audience: {{presentation.audience}}</p>
      </div>
      <div class="prompt-list" aria-label="Audience prompts">
        <p><span>Context</span>Where does the problem happen?</p>
        <p><span>Trigger</span>What starts the difficult moment?</p>
        <p><span>Constraint</span>What makes the current workaround fail?</p>
      </div>
    </section>

    <section id="insight" class="slide statement-slide" data-slide aria-labelledby="insight-title" hidden>
      <div class="slide-index" aria-hidden="true">04</div>
      <div class="slide-copy wide-copy">
        <h2 id="insight-title">State the insight only your demo makes tangible.</h2>
        <p class="lead">Connect the observed problem to one design decision. Remove this prompt once the sentence is specific.</p>
      </div>
    </section>

    <section id="solution" class="slide split-slide" data-slide aria-labelledby="solution-title" hidden>
      <div class="slide-index" aria-hidden="true">05</div>
      <div class="slide-copy">
        <h2 id="solution-title">One promise. One visible slice.</h2>
        <p class="lead">{{project.purpose}}</p>
      </div>
      <ol class="numbered-flow">
        <li><span>01</span>Show the starting state.</li>
        <li><span>02</span>Perform the meaningful action.</li>
        <li><span>03</span>Reveal the observable result.</li>
      </ol>
    </section>

    <section id="demo" class="slide demo-slide" data-slide aria-labelledby="demo-title" hidden>
      <div class="slide-index" aria-hidden="true">06</div>
      <div class="slide-copy wide-copy">
        <h2 id="demo-title">Let the product do the talking.</h2>
        <p class="lead">Open the known local state, run the shortest complete journey, and stop on the result.</p>
      </div>
      <div class="demo-rail">
        <p><strong>Live path</strong><span>Add exact launch and interaction steps.</span></p>
        <p><strong>Fallback</strong><span>Add a current local screenshot or recording.</span></p>
      </div>
    </section>

    <section id="evidence" class="slide evidence-slide" data-slide aria-labelledby="evidence-title" hidden>
      <div class="slide-index" aria-hidden="true">07</div>
      <div class="slide-copy wide-copy">
        <h2 id="evidence-title">What this revision proves.</h2>
        <p class="lead">Quality command: {{quality.summary}}</p>
      </div>
      <div class="evidence-lines">
        <p><strong>Add verified evidence</strong><span>Current task receipt and Git revision.</span></p>
        <p><strong>Add verified evidence</strong><span>Observed desktop and mobile behavior.</span></p>
        <p><strong>Add verified evidence</strong><span>Known limitation stated without spin.</span></p>
      </div>
    </section>

    <section id="architecture" class="slide architecture-slide" data-slide aria-labelledby="architecture-title" hidden>
      <div class="slide-index" aria-hidden="true">08</div>
      <div class="slide-copy wide-copy">
        <h2 id="architecture-title">Show only the architecture that explains the outcome.</h2>
      </div>
      <div class="architecture-flow" aria-label="Architecture prompt">
        <div><span>Input</span><strong>Starting signal</strong></div>
        <div><span>Core</span><strong>Product decision</strong></div>
        <div><span>Output</span><strong>Visible result</strong></div>
        <div><span>Proof</span><strong>Revision receipt</strong></div>
      </div>
    </section>

    <section id="value" class="slide split-slide" data-slide aria-labelledby="value-title" hidden>
      <div class="slide-index" aria-hidden="true">09</div>
      <div class="slide-copy">
        <h2 id="value-title">Translate the result into value.</h2>
        <p class="lead">Describe the change for the audience without inventing scale, savings, or adoption.</p>
      </div>
      <div class="proof-slot"><strong>Add verified evidence</strong><span>Use a measured result or label the hypothesis clearly.</span></div>
    </section>

    <section id="ask" class="slide closing-slide" data-slide aria-labelledby="ask-title" hidden>
      <div class="slide-index" aria-hidden="true">10</div>
      <div class="slide-copy wide-copy">
        <h2 id="ask-title">Make the next decision easy.</h2>
        <p class="lead">Ask for one specific next step that follows from the demonstrated evidence.</p>
        <p class="closing-name">{{project.name}}</p>
      </div>
    </section>
  </main>

  <nav class="controls" aria-label="Slide navigation">
    <button id="previous-slide" class="nav-button" type="button" aria-label="Previous slide">
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M19 12H5M11 6l-6 6 6 6"></path></svg>
      <span>Previous</span>
    </button>
    <div class="progress-group">
      <div id="slide-progress" class="progress-track" role="progressbar" aria-label="Presentation progress" aria-valuemin="1" aria-valuemax="10" aria-valuenow="1"><span></span></div>
      <p id="slide-status" aria-live="polite" aria-atomic="true">01 / 10</p>
    </div>
    <button id="next-slide" class="nav-button nav-button-next" type="button" aria-label="Next slide">
      <span>Next</span>
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M5 12h14M13 6l6 6-6 6"></path></svg>
    </button>
  </nav>

  <script src="app.js"></script>
</body>
</html>
