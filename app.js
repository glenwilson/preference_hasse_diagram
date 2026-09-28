import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth,
  signInAnonymously,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getDatabase,
  onValue,
  ref,
  runTransaction,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyAMIRDuWLWdBCUIVatW81gVV0lJREj1_OU",
  authDomain: "preference-hasse-diagram.firebaseapp.com",
  databaseURL: "https://preference-hasse-diagram-default-rtdb.firebaseio.com",
  projectId: "preference-hasse-diagram",
  storageBucket: "preference-hasse-diagram.firebasestorage.app",
  messagingSenderId: "505355281934",
  appId: "1:505355281934:web:a4bc4c037181ee9996fe5f",
};

const songs = [
  { id: "blue-suede-shoes", title: "Blue Suede Shoes", artist: "Elvis Presley" },
  { id: "thunderstruck", title: "Thunderstruck", artist: "AC/DC" },
  { id: "bohemian-rhapsody", title: "Bohemian Rhapsody", artist: "Queen" },
  { id: "billie-jean", title: "Billie Jean", artist: "Michael Jackson" },
  { id: "like-a-rolling-stone", title: "Like a Rolling Stone", artist: "Bob Dylan" },
  { id: "respect", title: "Respect", artist: "Aretha Franklin" },
  { id: "smells-like-teen-spirit", title: "Smells Like Teen Spirit", artist: "Nirvana" },
  { id: "hey-jude", title: "Hey Jude", artist: "The Beatles" },
  { id: "purple-rain", title: "Purple Rain", artist: "Prince" },
  {
    id: "bethoven",
    title: "Bethoven's Fifth Symphony",
    artist: "The New York Philharmonic",
  },
  {
    id: "bach",
    title: "Toccata and Fugue in D Minor, BWV 565",
    artist: "Simon Preston",
  },
  {
    id: "klatremus",
    title: "Klatremusvise",
    artist: "Thorbjørn Egner",
  },
];

const songById = new Map(songs.map((song) => [song.id, song]));

/* Page elements */

const buttonA = document.querySelector("#song-a-button");
const buttonB = document.querySelector("#song-b-button");
const incomparableButton = document.querySelector("#incomparable-button");
const skipButton = document.querySelector("#skip-button");

const crowdModeButton = document.querySelector("#crowd-mode-button");
const personalModeButton = document.querySelector("#personal-mode-button");
const resetPersonalButton = document.querySelector("#reset-personal-button");

const statusElement = document.querySelector("#vote-status");
const statsElement = document.querySelector("#stats");
const modeDescriptionElement = document.querySelector("#mode-description");
const explanationElement = document.querySelector("#order-explanation");

const svg = d3.select("#hasse-diagram");

/* App state */

const PERSONAL_STORAGE_KEY = "preference-hasse-personal-sandbox-v1";
const PERSONAL_USER_ID = "local-teaching-user";

let db = null;
let uid = null;

let crowdState = {};
let personalState = loadPersonalState();

let mode = "crowd";
let activePair = randomPair();
let submitting = false;

/* Start immediately. The page renders before Firebase connects. */

attachEventListeners();
render();
connectFirebase();

/* ------------------------------------------------------------------ */
/* Mode controls                                                      */
/* ------------------------------------------------------------------ */

function attachEventListeners() {
  crowdModeButton.addEventListener("click", () => switchMode("crowd"));

  personalModeButton.addEventListener("click", () => switchMode("personal"));

  resetPersonalButton.addEventListener("click", resetPersonalSandbox);

  buttonA.addEventListener("click", () => {
    if (activePair) submitResponse(activePair.a);
  });

  buttonB.addEventListener("click", () => {
    if (activePair) submitResponse(activePair.b);
  });

  incomparableButton.addEventListener("click", () => {
    submitResponse("incomparable");
  });

  skipButton.addEventListener("click", skipPair);
}

function switchMode(newMode) {
  mode = newMode;

  if (mode === "personal") {
    activePair = chooseNextPair(personalState, PERSONAL_USER_ID, activePair?.key);

    if (!activePair) {
      activePair = randomPair();
    }

    status("Teaching sandbox mode: responses are stored only in this browser.");
  } else {
    activePair = chooseNextPair(crowdState, uid, activePair?.key);

    if (!activePair) {
      activePair = randomPair();
    }

    status("Crowd mode: shared responses update in real time.");
  }

  render();
}

function resetPersonalSandbox() {
  const okay = window.confirm(
    "Reset your teaching sandbox? This removes only your local responses. It will not affect Firebase crowd data."
  );

  if (!okay) return;

  personalState = emptyState();
  savePersonalState();

  if (mode === "personal") {
    activePair = randomPair();
    status("Teaching sandbox reset. All songs are incomparable again.");
    render();
  }
}

function updateModeControls() {
  const personal = mode === "personal";

  crowdModeButton.classList.toggle("active", !personal);
  personalModeButton.classList.toggle("active", personal);

  modeDescriptionElement.textContent = personal
    ? "Teaching sandbox mode uses only your own browser. It does not modify crowd data."
    : "Crowd mode uses shared Firebase responses and updates in real time.";
}

/* ------------------------------------------------------------------ */
/* Firebase                                                           */
/* ------------------------------------------------------------------ */

async function connectFirebase() {
  try {
    const app = initializeApp(firebaseConfig);
    const auth = getAuth(app);

    db = getDatabase(app);

    const credential = await signInAnonymously(auth);
    uid = credential.user.uid;

    onValue(
      ref(db),
      (snapshot) => {
        crowdState = snapshot.val() || {};

        if (mode === "crowd") {
          const userVotes = crowdState.userVotes?.[uid] || {};

          if (!activePair || userVotes[activePair.key]) {
            activePair = chooseNextPair(crowdState, uid, activePair?.key);
          }
        }

        if (mode === "crowd") {
          status("Connected. Crowd responses update in real time.");
        }

        render();
      },
      (error) => {
        console.error(error);

        if (mode === "crowd") {
          status("Could not read crowd data from Firebase.");
        }
      }
    );
  } catch (error) {
    console.error(error);

    if (mode === "crowd") {
      status("Firebase connection failed. Switch to My teaching sandbox to use the local demo.");
    }

    render();
  }
}

/* ------------------------------------------------------------------ */
/* Local personal sandbox storage                                     */
/* ------------------------------------------------------------------ */

function emptyState() {
  return {
    pairs: {},
    userVotes: {},
  };
}

function loadPersonalState() {
  try {
    const stored = localStorage.getItem(PERSONAL_STORAGE_KEY);

    if (!stored) return emptyState();

    const parsed = JSON.parse(stored);

    return {
      pairs: parsed.pairs || {},
      userVotes: parsed.userVotes || {},
    };
  } catch (error) {
    console.warn("Could not load local teaching sandbox:", error);
    return emptyState();
  }
}

function savePersonalState() {
  localStorage.setItem(PERSONAL_STORAGE_KEY, JSON.stringify(personalState));
}

function activeState() {
  return mode === "personal" ? personalState : crowdState;
}

/* ------------------------------------------------------------------ */
/* Pair selection                                                     */
/* ------------------------------------------------------------------ */

function makePair(songOne, songTwo) {
  const [a, b] = [songOne.id, songTwo.id].sort();

  return {
    key: `${a}__${b}`,
    a,
    b,
  };
}

function allPairs() {
  const pairs = [];

  for (let i = 0; i < songs.length; i += 1) {
    for (let j = i + 1; j < songs.length; j += 1) {
      pairs.push(makePair(songs[i], songs[j]));
    }
  }

  return pairs;
}

function randomPair() {
  const pairs = allPairs();
  return pairs[Math.floor(Math.random() * pairs.length)];
}

function countResponses(data, pair) {
  const pairData = data.pairs?.[pair.key] || {};

  return (
    (pairData.aWins || 0) +
    (pairData.bWins || 0) +
    (pairData.incomparable || 0)
  );
}

function chooseNextPair(data, voterId, excludeKey = null) {
  if (!voterId) return randomPair();

  const voterResponses = data.userVotes?.[voterId] || {};

  let available = allPairs().filter(
    (pair) => !voterResponses[pair.key] && pair.key !== excludeKey
  );

  if (available.length === 0) {
    available = allPairs().filter((pair) => !voterResponses[pair.key]);
  }

  if (available.length === 0) return null;

  const minimumCount = Math.min(
    ...available.map((pair) => countResponses(data, pair))
  );

  const leastCompared = available.filter(
    (pair) => countResponses(data, pair) === minimumCount
  );

  return leastCompared[Math.floor(Math.random() * leastCompared.length)];
}

/* ------------------------------------------------------------------ */
/* Responses                                                          */
/* ------------------------------------------------------------------ */

function submitResponse(choice) {
  if (mode === "personal") {
    submitPersonalResponse(choice);
  } else {
    submitCrowdResponse(choice);
  }
}

function submitPersonalResponse(choice) {
  if (!activePair || submitting) return;

  const pair = activePair;

  personalState.pairs ||= {};
  personalState.userVotes ||= {};
  personalState.userVotes[PERSONAL_USER_ID] ||= {};

  if (personalState.userVotes[PERSONAL_USER_ID][pair.key]) {
    status("You have already answered this pair in the teaching sandbox.");
    return;
  }

  const pairData = personalState.pairs[pair.key] || {
    a: pair.a,
    b: pair.b,
    aWins: 0,
    bWins: 0,
    incomparable: 0,
  };

  if (choice === pair.a) {
    pairData.aWins += 1;
  } else if (choice === pair.b) {
    pairData.bWins += 1;
  } else if (choice === "incomparable") {
    pairData.incomparable += 1;
  } else {
    return;
  }

  personalState.pairs[pair.key] = pairData;
  personalState.userVotes[PERSONAL_USER_ID][pair.key] = choice;

  savePersonalState();

  activePair = chooseNextPair(personalState, PERSONAL_USER_ID, pair.key);

  if (choice === "incomparable") {
    status("Recorded as incomparable in your teaching sandbox.");
  } else {
    status("Relation added to your teaching sandbox.");
  }

  render();
}

async function submitCrowdResponse(choice) {
  if (!db || !uid || !activePair || submitting) {
    status("Crowd mode is not connected to Firebase.");
    return;
  }

  submitting = true;
  renderComparison();
  status("Saving your crowd response…");

  const pair = activePair;

  try {
    const result = await runTransaction(ref(db), (currentData) => {
      const data = currentData || {};

      data.pairs ||= {};
      data.userVotes ||= {};
      data.userVotes[uid] ||= {};

      if (data.userVotes[uid][pair.key]) {
        return;
      }

      const pairData = data.pairs[pair.key] || {
        a: pair.a,
        b: pair.b,
        aWins: 0,
        bWins: 0,
        incomparable: 0,
      };

      if (choice === pair.a) {
        pairData.aWins = (pairData.aWins || 0) + 1;
      } else if (choice === pair.b) {
        pairData.bWins = (pairData.bWins || 0) + 1;
      } else if (choice === "incomparable") {
        pairData.incomparable = (pairData.incomparable || 0) + 1;
      } else {
        return;
      }

      data.pairs[pair.key] = pairData;
      data.userVotes[uid][pair.key] = choice;

      return data;
    });

    if (!result.committed) {
      status("You have already answered this crowd comparison.");
      return;
    }

    crowdState = result.snapshot.val() || crowdState;
    activePair = chooseNextPair(crowdState, uid, pair.key);

    status(
      choice === "incomparable"
        ? "Recorded as incomparable in the crowd data."
        : "Crowd preference recorded."
    );
  } catch (error) {
    console.error(error);
    status("Could not save the crowd response.");
  } finally {
    submitting = false;
    render();
  }
}

function skipPair() {
  if (submitting) return;

  if (mode === "personal") {
    activePair = chooseNextPair(personalState, PERSONAL_USER_ID, activePair?.key);
  } else {
    activePair = chooseNextPair(crowdState, uid, activePair?.key);
  }

  if (!activePair) {
    status("You have answered every available pair.");
  } else {
    status("Pair skipped.");
  }

  renderComparison();
}

/* ------------------------------------------------------------------ */
/* Partial order construction                                         */
/* ------------------------------------------------------------------ */

function buildPartialOrder(data) {
  const candidates = [];

  for (const pair of Object.values(data.pairs || {})) {
    if (!songById.has(pair.a) || !songById.has(pair.b)) continue;

    const aWins = pair.aWins || 0;
    const bWins = pair.bWins || 0;
    const incomparable = pair.incomparable || 0;

    const total = aWins + bWins + incomparable;

    if (total === 0 || aWins === bWins) continue;

    const from = aWins > bWins ? pair.a : pair.b;
    const to = aWins > bWins ? pair.b : pair.a;

    const winnerVotes = Math.max(aWins, bWins);
    const loserVotes = Math.min(aWins, bWins);

    /*
      Incomparability counts against the direction. A relation requires
      more than half of all non-skip responses.
    */
    const support = winnerVotes / total;

    if (support <= 0.5) continue;

    candidates.push({
      from,
      to,
      confidence:
        (winnerVotes - loserVotes) * support * Math.log2(total + 1),
    });
  }

  candidates.sort(
    (left, right) =>
      right.confidence - left.confidence ||
      left.from.localeCompare(right.from) ||
      left.to.localeCompare(right.to)
  );

  const adjacency = new Map(songs.map((song) => [song.id, new Set()]));
  const accepted = [];
  const cycleRejected = [];

  for (const edge of candidates) {
    /*
      Reject A → B if B can already reach A. Adding it would create a cycle.
    */
    if (hasPath(adjacency, edge.to, edge.from)) {
      cycleRejected.push(edge);
      continue;
    }

    adjacency.get(edge.from).add(edge.to);
    accepted.push(edge);
  }

  return {
    accepted,
    cycleRejected,
    hasseEdges: transitiveReduction(accepted),
  };
}

function hasPath(adjacency, start, target) {
  const stack = [start];
  const visited = new Set();

  while (stack.length > 0) {
    const current = stack.pop();

    if (current === target) return true;
    if (visited.has(current)) continue;

    visited.add(current);

    for (const next of adjacency.get(current) || []) {
      if (!visited.has(next)) stack.push(next);
    }
  }

  return false;
}

function transitiveReduction(edges) {
  const adjacency = new Map(songs.map((song) => [song.id, new Set()]));

  for (const edge of edges) {
    adjacency.get(edge.from).add(edge.to);
  }

  const reduced = [];

  for (const edge of edges) {
    adjacency.get(edge.from).delete(edge.to);

    if (!hasPath(adjacency, edge.from, edge.to)) {
      adjacency.get(edge.from).add(edge.to);
      reduced.push(edge);
    }
  }

  return reduced;
}

/* ------------------------------------------------------------------ */
/* Rendering                                                          */
/* ------------------------------------------------------------------ */

function render() {
  updateModeControls();
  renderComparison();
  renderStats();

  const order = buildPartialOrder(activeState());

  renderDiagram(order.hasseEdges);
  renderExplanation(order);
}

function renderComparison() {
  if (!activePair) {
    buttonA.innerHTML = `<span class="song-title">All pairs answered</span>`;
    buttonB.innerHTML = `<span class="song-title">Thank you!</span>`;
    setResponseButtonsDisabled(true);
    return;
  }

  const songA = songById.get(activePair.a);
  const songB = songById.get(activePair.b);

  buttonA.innerHTML = songMarkup(songA);
  buttonB.innerHTML = songMarkup(songB);

  const crowdUnavailable = mode === "crowd" && (!db || !uid);

  setResponseButtonsDisabled(submitting || crowdUnavailable);
}

function songMarkup(song) {
  return `
    <span class="song-title">${escapeHtml(song.title)}</span>
    <span class="song-artist">${escapeHtml(song.artist)}</span>
  `;
}

function setResponseButtonsDisabled(disabled) {
  buttonA.disabled = disabled;
  buttonB.disabled = disabled;
  incomparableButton.disabled = disabled;
  skipButton.disabled = disabled;
}

function renderStats() {
  const pairs = Object.values(activeState().pairs || {});

  const directional = pairs.reduce(
    (sum, pair) => sum + (pair.aWins || 0) + (pair.bWins || 0),
    0
  );

  const incomparable = pairs.reduce(
    (sum, pair) => sum + (pair.incomparable || 0),
    0
  );

  const total = directional + incomparable;

  statsElement.textContent =
    `${total} response${total === 1 ? "" : "s"} · ` +
    `${incomparable} incomparable`;
}

function renderExplanation(order) {
  const source = mode === "personal" ? "your sandbox" : "the crowd";

  explanationElement.innerHTML = `
    <strong>How this order is formed</strong>

    <p>
      In ${source}, a directional relation is included only when one song gets
      more than half of all responses for that pair. Incomparable responses
      count against directional support.
    </p>

    <p>
      There ${order.accepted.length === 1 ? "is" : "are"}
      <strong>${order.accepted.length}</strong> accepted relation${
        order.accepted.length === 1 ? "" : "s"
      }.
    </p>

    <p>
      ${
        order.cycleRejected.length === 0
          ? "No candidate relation currently creates a cycle."
          : `${order.cycleRejected.length} weaker relation${
              order.cycleRejected.length === 1 ? "" : "s"
            } were excluded because they would create a cycle.`
      }
    </p>

    <p>
      The visible edges are transitively reduced: if A &gt; B and B &gt; C,
      the implied relation A &gt; C is not drawn separately.
    </p>
  `;
}

function renderDiagram(edges) {
  svg.selectAll("*").remove();

  const width = 1500;
  const graph = layoutGraph(edges, width);
  const height = Math.max(500, graph.height);

  svg.attr("viewBox", `0 0 ${width} ${height}`);

  if (edges.length === 0) {
    svg
      .append("text")
      .attr("class", "empty-graph-message")
      .attr("x", width / 2)
      .attr("y", 42)
      .attr("text-anchor", "middle")
      .text("No ordering relations yet — all songs are currently incomparable.");
  }

  const defs = svg.append("defs");

  defs
    .append("marker")
    .attr("id", "arrowhead")
    .attr("viewBox", "0 -5 10 10")
    .attr("refX", 11)
    .attr("refY", 0)
    .attr("markerWidth", 6)
    .attr("markerHeight", 6)
    .attr("orient", "auto")
    .append("path")
    .attr("fill", "#94a3b8")
    .attr("d", "M0,-5L10,0L0,5");

  svg
    .append("g")
    .selectAll("line")
    .data(edges)
    .join("line")
    .attr("class", "edge")
    .attr("x1", (edge) => graph.positions.get(edge.from).x)
    .attr("y1", (edge) => graph.positions.get(edge.from).y + 19)
    .attr("x2", (edge) => graph.positions.get(edge.to).x)
    .attr("y2", (edge) => graph.positions.get(edge.to).y - 19)
    .attr("marker-end", "url(#arrowhead)");

  const nodes = svg
    .append("g")
    .selectAll("g")
    .data(songs)
    .join("g")
    .attr("transform", (song) => {
      const position = graph.positions.get(song.id);
      return `translate(${position.x}, ${position.y})`;
    });

  nodes.append("circle").attr("class", "node-circle").attr("r", 18);

  nodes
    .append("text")
    .attr("class", "node-label")
    .attr("x", 28)
    .attr("y", -2)
    .text((song) => song.title);

  nodes
    .append("text")
    .attr("class", "node-artist")
    .attr("x", 28)
    .attr("y", 14)
    .text((song) => song.artist);
}

function layoutGraph(edges, width) {
  const adjacency = new Map(songs.map((song) => [song.id, []]));
  const inDegree = new Map(songs.map((song) => [song.id, 0]));
  const rank = new Map(songs.map((song) => [song.id, 0]));

  for (const edge of edges) {
    adjacency.get(edge.from).push(edge.to);
    inDegree.set(edge.to, inDegree.get(edge.to) + 1);
  }

  const queue = songs
    .filter((song) => inDegree.get(song.id) === 0)
    .map((song) => song.id);

  while (queue.length > 0) {
    const current = queue.shift();

    for (const next of adjacency.get(current)) {
      rank.set(next, Math.max(rank.get(next), rank.get(current) + 1));
      inDegree.set(next, inDegree.get(next) - 1);

      if (inDegree.get(next) === 0) {
        queue.push(next);
      }
    }
  }

  const levels = d3.group(songs, (song) => rank.get(song.id));
  const positions = new Map();
  const maxRank = Math.max(...rank.values());

  const startingY = edges.length === 0 ? 135 : 70;

  for (const [level, levelSongs] of levels) {
    levelSongs.sort((a, b) => a.title.localeCompare(b.title));

    const spacing = width / (levelSongs.length + 1);

    levelSongs.forEach((song, index) => {
      positions.set(song.id, {
        x: spacing * (index + 1),
        y: startingY + level * 125,
      });
    });
  }

  return {
    positions,
    height: startingY + maxRank * 125 + 130,
  };
}

/* ------------------------------------------------------------------ */
/* Utilities                                                          */
/* ------------------------------------------------------------------ */

function status(message) {
  statusElement.textContent = message;
}

function escapeHtml(value) {
  const element = document.createElement("div");
  element.textContent = value;
  return element.innerHTML;
}
