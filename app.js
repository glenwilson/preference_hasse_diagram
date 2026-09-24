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
  Replace this object with Firebase Console → Project settings →
  General → Your apps → Web app → SDK setup and configuration.
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
  { id: "dreams", title: "Dreams", artist: "Fleetwood Mac" },
];

const songById = new Map(songs.map((song) => [song.id, song]));

const buttonA = document.querySelector("#song-a-button");
const buttonB = document.querySelector("#song-b-button");
const statusElement = document.querySelector("#vote-status");
const statsElement = document.querySelector("#stats");
const svg = d3.select("#hasse-diagram");

let db;
let uid;
let state = {};
let activePair = null;
let submitting = false;

/* ---------- Firebase setup ---------- */

async function start() {
  try {
    const app = initializeApp(firebaseConfig);
    const auth = getAuth(app);
    db = getDatabase(app);

    const credential = await signInAnonymously(auth);
    uid = credential.user.uid;

    status("Choose the song you prefer.");
    subscribeToVotes();
  } catch (error) {
    console.error(error);
    status(
      "Unable to connect. Check your Firebase configuration and enabled Anonymous Authentication."
    );
    setButtonsDisabled(true);
  }
}

function subscribeToVotes() {
  onValue(
    ref(db),
    (snapshot) => {
      state = snapshot.val() || {};

      const alreadyVotedForActivePair =
        activePair && state.userVotes?.[uid]?.[activePair.key];

      if (!activePair || alreadyVotedForActivePair) {
        activePair = chooseNextPair();
      }

      render();
    },
    (error) => {
      console.error(error);
      status("Could not read live voting data.");
    }
  );
}

/* ---------- Pair selection and voting ---------- */

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

function chooseNextPair() {
  const voted = state.userVotes?.[uid] || {};
  const pairs = allPossiblePairs().filter((pair) => !voted[pair.key]);

  if (pairs.length === 0) return null;

  /*
    Prefer pairs with the fewest total votes. This spreads crowd attention
    across under-compared song pairs.
  */
  const voteCount = (pair) => {
    const data = state.pairs?.[pair.key];
    return (data?.aWins || 0) + (data?.bWins || 0);
  };

  const leastVotes = Math.min(...pairs.map(voteCount));
  const leastComparedPairs = pairs.filter(
    (pair) => voteCount(pair) === leastVotes
  );

  return leastComparedPairs[
    Math.floor(Math.random() * leastComparedPairs.length)
  ];
}

async function submitVote(winnerId) {
  if (!activePair || submitting) return;

  submitting = true;
  setButtonsDisabled(true);
  status("Saving your vote…");

  const pair = activePair;

  try {
    const result = await runTransaction(ref(db), (currentData) => {
      const data = currentData || {};
      data.pairs = data.pairs || {};
      data.userVotes = data.userVotes || {};
      data.userVotes[uid] = data.userVotes[uid] || {};

      /*
        This prevents ordinary duplicate votes by the same anonymous Firebase
        account for a given song pair.
      */
      if (data.userVotes[uid][pair.key]) {
        return;
      }

      const pairData = data.pairs[pair.key] || {
        a: pair.a,
        b: pair.b,
        aWins: 0,
        bWins: 0,
      };

      if (winnerId === pairData.a) {
        pairData.aWins += 1;
      } else {
        pairData.bWins += 1;
      }

      data.pairs[pair.key] = pairData;
      data.userVotes[uid][pair.key] = true;

      return data;
    });

    if (!result.committed) {
      status("This pair was already recorded for this browser.");
    } else {
      status("Vote saved. Loading another comparison…");
    }
  } catch (error) {
    console.error(error);
    status("Your vote could not be saved. Please try again.");
  } finally {
    submitting = false;
    setButtonsDisabled(false);
  }
}

/* ---------- Hasse diagram generation ---------- */

/*
  Each majority result produces a candidate directed relation:

      preferred song  →  less preferred song

  Crowd voting can create cycles, e.g. A > B, B > C, C > A.
  A Hasse diagram must represent a partial order, so we sort relationships
  by confidence and only accept one if it does not introduce a cycle.
*/
function buildPartialOrder() {
  const pairData = Object.values(state.pairs || {});
  const candidates = [];

  for (const pair of pairData) {
    const aWins = pair.aWins || 0;
    const bWins = pair.bWins || 0;

    if (aWins === bWins) continue;

    const total = aWins + bWins;
    const margin = Math.abs(aWins - bWins);

    candidates.push({
      from: aWins > bWins ? pair.a : pair.b,
      to: aWins > bWins ? pair.b : pair.a,
      total,
      margin,

      /*
        Favors a strong majority with more than one vote while still allowing
        the graph to begin forming immediately.
      */
      confidence: margin * Math.log2(total + 1),
    });
  }

  candidates.sort(
    (left, right) =>
      right.confidence - left.confidence ||
      right.total - left.total ||
      right.margin - left.margin
  );

  const adjacency = new Map(songs.map((song) => [song.id, new Set()]));
  const accepted = [];

  for (const edge of candidates) {
    /*
      If there is already a path from edge.to to edge.from, adding
      edge.from → edge.to would create a cycle.
    */
    if (!hasPath(adjacency, edge.to, edge.from)) {
      adjacency.get(edge.from).add(edge.to);
      accepted.push(edge);
    }
  }

  return transitiveReduction(accepted);
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
      if (!visited.has(next)) stack.push(next);
    }
  }

  return false;
}

/*
  A Hasse diagram contains only cover edges. If A > B and B > C, then
  A > C is implied and should not appear as an edge.
*/
function transitiveReduction(edges) {
  const adjacency = new Map(songs.map((song) => [song.id, new Set()]));

  for (const edge of edges) {
    adjacency.get(edge.from).add(edge.to);
  }

  const reduced = [];

  for (const edge of edges) {
    adjacency.get(edge.from).delete(edge.to);

    const isImpliedByAnotherPath = hasPath(adjacency, edge.from, edge.to);

    if (isImpliedByAnotherPath) {
      continue;
    }

    adjacency.get(edge.from).add(edge.to);
    reduced.push(edge);
  }

  return reduced;
}

/* ---------- D3 rendering ---------- */

function render() {
  renderComparison();
  renderStats();
  renderDiagram(buildPartialOrder());
}

function renderComparison() {
  if (!activePair) {
    buttonA.innerHTML = "<span class='song-title'>All pairs completed</span>";
    buttonB.innerHTML = "<span class='song-title'>Thank you!</span>";
    setButtonsDisabled(true);
    status("You have voted on every available song pair.");
    return;
  }

  const songA = songById.get(activePair.a);
  const songB = songById.get(activePair.b);

  buttonA.innerHTML = songButtonMarkup(songA);
  buttonB.innerHTML = songButtonMarkup(songB);

  buttonA.onclick = () => submitVote(songA.id);
  buttonB.onclick = () => submitVote(songB.id);

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
  const totalVotes = pairs.reduce(
    (sum, pair) => sum + (pair.aWins || 0) + (pair.bWins || 0),
    0
  );

  const comparedPairs = pairs.filter(
    (pair) => (pair.aWins || 0) + (pair.bWins || 0) > 0
  ).length;

  statsElement.textContent = `${totalVotes} vote${
    totalVotes === 1 ? "" : "s"
  } · ${comparedPairs} compared pair${comparedPairs === 1 ? "" : "s"}`;
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

      if (inDegree.get(next) === 0) queue.push(next);
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
