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

/*
  Replace with your Firebase Web App configuration.
*/
const firebaseConfig = {
  apiKey: "AIzaSyAMIRDuWLWdBCUIVatW81gVV0lJREj1_OU", // Retrieve from Project Settings in the Firebase Console
  authDomain: "preference-hasse-diagram.firebaseapp.com",
  databaseURL: "https://preference-hasse-diagram-default-rtdb.firebaseio.com",
  projectId: "preference-hasse-diagram",
  storageBucket: "preference-hasse-diagram.firebasestorage.app",
  messagingSenderId: "505355281934", // Filled with your Project Number
  appId: "1:505355281934:web:a4bc4c037181ee9996fe5f", // Retrieve from Project Settings in the Firebase Console
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
  { id: "bethoven", title: "Bethoven's Fifth Symphony", artist: "The New York Philharmonic"},
  { id: "bach", title: "Toccata and Fugue in D Minor, BWV 565", artist: "Simon Preston"},
  { id: "klatremus", title: "Klatremusvise", artist: "Thorbjørn Egner"},
];

const songById = new Map(songs.map((song) => [song.id, song]));

const buttonA = document.querySelector("#song-a-button");
const buttonB = document.querySelector("#song-b-button");
const incomparableButton = document.querySelector("#incomparable-button");
const skipButton = document.querySelector("#skip-button");

const statusElement = document.querySelector("#vote-status");
const statsElement = document.querySelector("#stats");
const orderExplanationElement = document.querySelector("#order-explanation");
const svg = d3.select("#hasse-diagram");

let db;
let uid;
let state = {};
let activePair = null;
let submitting = false;

/* ---------- Firebase ---------- */

async function start() {
  try {
    const app = initializeApp(firebaseConfig);
    const auth = getAuth(app);

    db = getDatabase(app);

    const credential = await signInAnonymously(auth);
    uid = credential.user.uid;

    status("Choose the response that fits you.");
    subscribeToVotes();
  } catch (error) {
    console.error(error);

    status(
      "Unable to connect. Check Firebase configuration and Anonymous Authentication."
    );

    setButtonsDisabled(true);
  }
}

function subscribeToVotes() {
  onValue(
    ref(db),
    (snapshot) => {
      state = snapshot.val() || {};

      const alreadyRespondedToCurrentPair =
        activePair && state.userVotes?.[uid]?.[activePair.key];

      if (!activePair || alreadyRespondedToCurrentPair) {
        activePair = chooseNextPair(activePair?.key);
      }

      render();
    },
    (error) => {
      console.error(error);
      status("Could not read live voting data.");
    }
  );
}

/* ---------- Pair creation and selection ---------- */

function makePair(song1, song2) {
  const [a, b] = [song1.id, song2.id].sort();

  return {
    key: `${a}__${b}`,
    a,
    b,
  };
}

function allPossiblePairs() {
  const pairs = [];

  for (let i = 0; i < songs.length; i += 1) {
    for (let j = i + 1; j < songs.length; j += 1) {
      pairs.push(makePair(songs[i], songs[j]));
    }
  }

  return pairs;
}

function chooseNextPair(excludePairKey = null) {
  const votedPairs = state.userVotes?.[uid] || {};

  let availablePairs = allPossiblePairs().filter(
    (pair) => !votedPairs[pair.key] && pair.key !== excludePairKey
  );

  if (availablePairs.length === 0) {
    availablePairs = allPossiblePairs().filter(
      (pair) => !votedPairs[pair.key]
    );
  }

  if (availablePairs.length === 0) return null;

  /*
    Prioritize pairs with fewer crowd responses. This helps distribute votes
    more evenly across all available comparisons.
  */
  const responseCount = (pair) => {
    const data = state.pairs?.[pair.key];

    return (
      (data?.aWins || 0) +
      (data?.bWins || 0) +
      (data?.incomparable || 0)
    );
  };

  const fewestResponses = Math.min(...availablePairs.map(responseCount));

  const leastComparedPairs = availablePairs.filter(
    (pair) => responseCount(pair) === fewestResponses
  );

  return leastComparedPairs[
    Math.floor(Math.random() * leastComparedPairs.length)
  ];
}

/* ---------- Voting ---------- */

async function submitVote(choice) {
  if (!activePair || submitting) return;

  submitting = true;
  setButtonsDisabled(true);
  status("Saving your response…");

  const pair = activePair;

  try {
    const result = await runTransaction(ref(db), (currentData) => {
      const data = currentData || {};

      data.pairs = data.pairs || {};
      data.userVotes = data.userVotes || {};
      data.userVotes[uid] = data.userVotes[uid] || {};

      /*
        One non-skip response per anonymous Firebase account for a given pair.
      */
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

      if (choice === "incomparable") {
        pairData.incomparable = (pairData.incomparable || 0) + 1;
      } else if (choice === pairData.a) {
        pairData.aWins = (pairData.aWins || 0) + 1;
      } else if (choice === pairData.b) {
        pairData.bWins = (pairData.bWins || 0) + 1;
      } else {
        return;
      }

      data.pairs[pair.key] = pairData;
      data.userVotes[uid][pair.key] = choice;

      return data;
    });

if (!result.committed) {
  status("You have already responded to this pair.");
} else {
  /*
    Update this browser immediately using Firebase's transaction result.
    The normal onValue listener will also update every connected browser.
  */
  state = result.snapshot.val() || state;
  activePair = chooseNextPair(pair.key);

  if (choice === "incomparable") {
    status(
      "Recorded: these songs are incomparable to you. Loading another pair…"
    );
  } else {
    status("Preference recorded. Loading another comparison…");
  }

  render();
}
  } catch (error) {
    console.error(error);
    status("Your response could not be saved. Please try again.");
  } finally {
    submitting = false;
    setButtonsDisabled(false);
  }
}

function skipPair() {
  if (submitting) return;

  const previousPairKey = activePair?.key;
  activePair = chooseNextPair(previousPairKey);

  if (!activePair) {
    status("You have responded to every available song pair.");
  } else {
    status("Pair skipped. Choose the response that fits you.");
  }

  renderComparison();
}

/* ---------- Partial-order construction ---------- */

/*
  Each candidate relation has the form:

      preferred song → less preferred song

  A pair produces a candidate relation only when:
    1. There are at least three total responses.
    2. One directional preference has more votes than the other.
    3. The winner receives more than 50% of ALL non-skip responses,
       including "incomparable" responses.

  Therefore, a large number of incomparable responses prevents a directional
  relation from entering the crowd partial order.
*/
function buildPartialOrder() {
  const pairData = Object.values(state.pairs || {});
  const candidates = [];

  const minimumResponses = 1;
  const requiredSupport = 0.5;

  for (const pair of pairData) {
    const aWins = pair.aWins || 0;
    const bWins = pair.bWins || 0;
    const incomparable = pair.incomparable || 0;

    const totalResponses = aWins + bWins + incomparable;

    if (totalResponses < minimumResponses) continue;
    if (aWins === bWins) continue;

    const winner = aWins > bWins ? pair.a : pair.b;
    const loser = aWins > bWins ? pair.b : pair.a;

    const winnerVotes = Math.max(aWins, bWins);
    const loserVotes = Math.min(aWins, bWins);
    const support = winnerVotes / totalResponses;

    if (support <= requiredSupport) continue;

    candidates.push({
      from: winner,
      to: loser,
      winnerVotes,
      loserVotes,
      incomparable,
      totalResponses,
      support,

      /*
        Higher confidence means a larger directional margin, greater support,
        and more total responses.
      */
      confidence:
        (winnerVotes - loserVotes) *
        support *
        Math.log2(totalResponses + 1),
    });
  }

  /*
    Stronger relationships are accepted first.

    The last tie-breakers make the result deterministic even where two
    candidate relations have identical scores.
  */
  candidates.sort(
    (left, right) =>
      right.confidence - left.confidence ||
      right.support - left.support ||
      right.totalResponses - left.totalResponses ||
      left.from.localeCompare(right.from) ||
      left.to.localeCompare(right.to)
  );

  const adjacency = new Map(songs.map((song) => [song.id, new Set()]));
  const acceptedRelations = [];
  const cycleRejectedRelations = [];

  for (const edge of candidates) {
    /*
      Adding A → B would create a cycle precisely when B can already reach A.

      Example:
        A → B and B → C already exist.
        Trying to add C → A creates A → B → C → A.
    */
    if (hasPath(adjacency, edge.to, edge.from)) {
      cycleRejectedRelations.push(edge);
      continue;
    }

    adjacency.get(edge.from).add(edge.to);
    acceptedRelations.push(edge);
  }

  return {
    acceptedRelations,
    cycleRejectedRelations,
    hasseEdges: transitiveReduction(acceptedRelations),
  };
}

function hasPath(adjacency, start, target) {
  const stack = [start];
  const visited = new Set();

  while (stack.length > 0) {
    const node = stack.pop();

    if (node === target) return true;
    if (visited.has(node)) continue;

    visited.add(node);

    for (const next of adjacency.get(node) || []) {
      if (!visited.has(next)) {
        stack.push(next);
      }
    }
  }

  return false;
}

/*
  A Hasse diagram displays only cover relations.

  If A > B and B > C, then A > C is transitive and is not drawn as a
  separate edge.
*/
function transitiveReduction(edges) {
  const adjacency = new Map(songs.map((song) => [song.id, new Set()]));

  for (const edge of edges) {
    adjacency.get(edge.from).add(edge.to);
  }

  const reducedEdges = [];

  for (const edge of edges) {
    adjacency.get(edge.from).delete(edge.to);

    const impliedByAnotherPath = hasPath(adjacency, edge.from, edge.to);

    if (!impliedByAnotherPath) {
      adjacency.get(edge.from).add(edge.to);
      reducedEdges.push(edge);
    }
  }

  return reducedEdges;
}

/* ---------- Rendering ---------- */

function render() {
  renderComparison();
  renderStats();

  const order = buildPartialOrder();

  renderDiagram(order.hasseEdges);
  renderOrderExplanation(order);
}

function renderComparison() {
  if (!activePair) {
    buttonA.innerHTML = "<span class='song-title'>All pairs completed</span>";
    buttonB.innerHTML = "<span class='song-title'>Thank you!</span>";

    setButtonsDisabled(true);

    status("You have responded to every available song pair.");
    return;
  }

  const songA = songById.get(activePair.a);
  const songB = songById.get(activePair.b);

  buttonA.innerHTML = songButtonMarkup(songA);
  buttonB.innerHTML = songButtonMarkup(songB);

  buttonA.onclick = () => submitVote(songA.id);
  buttonB.onclick = () => submitVote(songB.id);
  incomparableButton.onclick = () => submitVote("incomparable");
  skipButton.onclick = skipPair;

  setButtonsDisabled(submitting);
}

function songButtonMarkup(song) {
  return `
    <span class="song-title">${escapeHtml(song.title)}</span>
    <span class="song-artist">${escapeHtml(song.artist)}</span>
  `;
}

function renderStats() {
  const pairs = Object.values(state.pairs || {});

  const directionalVotes = pairs.reduce(
    (sum, pair) => sum + (pair.aWins || 0) + (pair.bWins || 0),
    0
  );

  const incomparableVotes = pairs.reduce(
    (sum, pair) => sum + (pair.incomparable || 0),
    0
  );

  const totalResponses = directionalVotes + incomparableVotes;

  statsElement.textContent =
    `${totalResponses} response${totalResponses === 1 ? "" : "s"} · ` +
    `${incomparableVotes} incomparable`;
}

function renderOrderExplanation(order) {
  const acceptedCount = order.acceptedRelations.length;
  const rejected = order.cycleRejectedRelations;

  let html = `
    <strong>How the crowd partial order is formed</strong>

A directional relation is considered as soon as there is a directional
response, but it remains visible only when one song receives more than
50% of all responses for that pair.
    <p>
      There ${acceptedCount === 1 ? "is" : "are"} currently
      <strong>${acceptedCount}</strong> accepted crowd-supported
      relation${acceptedCount === 1 ? "" : "s"}.
    </p>
  `;

  if (rejected.length === 0) {
    html += `
      <p>
        No candidate relations currently conflict with the displayed order.
      </p>
    `;
  } else {
    html += `
      <p>
        <strong>${rejected.length}</strong> weaker crowd-supported
        relation${rejected.length === 1 ? "" : "s"} ${
          rejected.length === 1 ? "was" : "were"
        } excluded because ${
          rejected.length === 1 ? "it would" : "they would"
        } create a cycle.
      </p>

      <ul>
        ${rejected
          .map((edge) => {
            const preferred = songById.get(edge.from);
            const lessPreferred = songById.get(edge.to);

            return `
              <li>
                ${escapeHtml(preferred.title)} &gt;
                ${escapeHtml(lessPreferred.title)}
                was excluded because it conflicts with stronger accepted
                relationships.
              </li>
            `;
          })
          .join("")}
      </ul>
    `;
  }

  html += `
    <p>
      The visible graph is a <em>Hasse diagram</em>, so it removes transitive
      edges. If A &gt; B and B &gt; C, the implied relation A &gt; C is not
      shown as an additional line.
    </p>
  `;

  orderExplanationElement.innerHTML = html;
}

function renderDiagram(edges) {
  svg.selectAll("*").remove();

  const width = 1000;
  const graph = layoutGraph(edges, width);
  const height = Math.max(400, graph.height);

  svg.attr("viewBox", `0 0 ${width} ${height}`);

  if (edges.length === 0) {
    svg
      .append("text")
      .attr("class", "empty-graph-message")
      .attr("x", width / 2)
      .attr("y", height / 2)
      .attr("text-anchor", "middle")
      .text("Vote on song pairs to begin building the preference order.");

    return;
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
    .attr("y1", (edge) => graph.positions.get(edge.from).y + 18)
    .attr("x2", (edge) => graph.positions.get(edge.to).x)
    .attr("y2", (edge) => graph.positions.get(edge.to).y - 18)
    .attr("marker-end", "url(#arrowhead)");

  const nodes = svg
    .append("g")
    .selectAll("g")
    .data(graph.nodes)
    .join("g")
    .attr(
      "transform",
      (song) =>
        `translate(${graph.positions.get(song.id).x}, ${
          graph.positions.get(song.id).y
        })`
    );

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

  for (const [level, levelSongs] of levels) {
    levelSongs.sort((a, b) => a.title.localeCompare(b.title));

    const spacing = width / (levelSongs.length + 1);

    levelSongs.forEach((song, index) => {
      positions.set(song.id, {
        x: spacing * (index + 1),
        y: 64 + level * 125,
      });
    });
  }

  return {
    nodes: songs,
    positions,
    height: 140 + maxRank * 125,
  };
}

/* ---------- Utilities ---------- */

function setButtonsDisabled(disabled) {
  buttonA.disabled = disabled;
  buttonB.disabled = disabled;
  incomparableButton.disabled = disabled;
  skipButton.disabled = disabled;
}

function status(message) {
  statusElement.textContent = message;
}

function escapeHtml(value) {
  const element = document.createElement("div");
  element.textContent = value;
  return element.innerHTML;
}

start();
