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
  projectId: "preference-hasse-diagram",
  storageBucket: "preference-hasse-diagram.firebasestorage.app",
  messagingSenderId: "505355281934",
  appId: "1:505355281934:web:a4bc4c037181ee9996fe5f",
  measurementId: "G-DNWRM2EYVR"
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

const buttonA = document.querySelector("#song-a-button");
const buttonB = document.querySelector("#song-b-button");
const incomparableButton = document.querySelector("#incomparable-button");
const skipButton = document.querySelector("#skip-button");
const statusElement = document.querySelector("#vote-status");
const statsElement = document.querySelector("#stats");
const explanationElement = document.querySelector("#order-explanation");
const svg = d3.select("#hasse-diagram");

let db = null;
let uid = null;
let state = {};
let activePair = null;
let submitting = false;

/*
  Render immediately, before Firebase has connected. This guarantees that
  all songs always appear in the diagram.
*/
activePair = randomPair();
render();
connectFirebase();

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

    status("Connected. Choose the response that fits you.");

    onValue(
      ref(db),
      (snapshot) => {
        state = snapshot.val() || {};

        const userVotes = state.userVotes?.[uid] || {};

        if (!activePair || userVotes[activePair.key]) {
          activePair = chooseNextUnansweredPair(activePair?.key);
        }

        render();
      },
      (error) => {
        console.error("Realtime Database read error:", error);
        status("Connected, but live vote data could not be read.");
      }
    );
  } catch (error) {
    console.error("Firebase connection error:", error);

    status(
      "Could not connect to Firebase. Songs are visible, but voting is unavailable."
    );

    setButtonsDisabled(true);
  }
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

function responseCount(pair) {
  const pairData = state.pairs?.[pair.key] || {};

  return (
    (pairData.aWins || 0) +
    (pairData.bWins || 0) +
    (pairData.incomparable || 0)
  );
}

function chooseNextUnansweredPair(excludeKey = null) {
  if (!uid) return randomPair();

  const userVotes = state.userVotes?.[uid] || {};

  let available = allPairs().filter(
    (pair) => !userVotes[pair.key] && pair.key !== excludeKey
  );

  if (available.length === 0) {
    available = allPairs().filter((pair) => !userVotes[pair.key]);
  }

  if (available.length === 0) return null;

  const fewestResponses = Math.min(...available.map(responseCount));

  const leastCompared = available.filter(
    (pair) => responseCount(pair) === fewestResponses
  );

  return leastCompared[Math.floor(Math.random() * leastCompared.length)];
}

/* ------------------------------------------------------------------ */
/* Voting                                                             */
/* ------------------------------------------------------------------ */

async function submitVote(choice) {
  if (!db || !uid || !activePair || submitting) return;

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
        Only one meaningful response per anonymous account per pair.
        Skip is not stored and does not call this function.
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
      status("You have already responded to this pair.");
      return;
    }

    /*
      Update the local page immediately. The Firebase onValue listener will
      also update every other open browser in real time.
    */
    state = result.snapshot.val() || state;
    activePair = chooseNextUnansweredPair(pair.key);

    if (choice === "incomparable") {
      status("Recorded as incomparable. Loading another comparison…");
    } else {
      status("Preference recorded. Loading another comparison…");
    }

    render();
  } catch (error) {
    console.error("Vote write error:", error);
    status("Could not save your response. Check Firebase rules.");
  } finally {
    submitting = false;
    setButtonsDisabled(false);
  }
}

function skipPair() {
  if (submitting) return;

  activePair = chooseNextUnansweredPair(activePair?.key);

  if (!activePair) {
    status("You have answered every available song pair.");
  } else {
    status("Pair skipped. Choose the response that fits you.");
  }

  renderComparison();
}

/* ------------------------------------------------------------------ */
/* Partial order and Hasse diagram                                    */
/* ------------------------------------------------------------------ */

/*
  A pair contributes a directional candidate edge only when:
  - one direction has more votes than the other direction; and
  - that winning direction has more than 50% of all responses,
    including incomparable responses.

  Example:
    A > B: 3 votes
    B > A: 0 votes
    Incomparable: 4 votes

  A > B has only 3 / 7 = 42.9% support, so no relation is displayed.
*/
function buildPartialOrder() {
  const candidates = [];

  for (const pair of Object.values(state.pairs || {})) {
    const aWins = pair.aWins || 0;
    const bWins = pair.bWins || 0;
    const incomparable = pair.incomparable || 0;
    const total = aWins + bWins + incomparable;

    if (total === 0 || aWins === bWins) continue;

    const from = aWins > bWins ? pair.a : pair.b;
    const to = aWins > bWins ? pair.b : pair.a;
    const winnerVotes = Math.max(aWins, bWins);
    const loserVotes = Math.min(aWins, bWins);
    const support = winnerVotes / total;

    /*
      Require strictly more than half of all recorded responses.
      This allows immediate diagram changes after one directional vote.
    */
    if (support <= 0.5) continue;

    candidates.push({
      from,
      to,
      support,
      total,
      winnerVotes,
      loserVotes,
      incomparable,
      confidence:
        (winnerVotes - loserVotes) * support * Math.log2(total + 1),
    });
  }

  /*
    Stronger relations are accepted first. This makes cycle handling
    deterministic and visible in the explanation below the diagram.
  */
  candidates.sort(
    (left, right) =>
      right.confidence - left.confidence ||
      right.support - left.support ||
      right.total - left.total ||
      left.from.localeCompare(right.from) ||
      left.to.localeCompare(right.to)
  );

  const adjacency = new Map(songs.map((song) => [song.id, new Set()]));
  const accepted = [];
  const cycleRejected = [];

  for (const edge of candidates) {
    /*
      Adding A -> B creates a cycle exactly when a path B -> ... -> A
      already exists among accepted relations.
    */
    if (hasPath(adjacency, edge.to, edge.from)) {
      cycleRejected.push(edge);
    } else {
      adjacency.get(edge.from).add(edge.to);
      accepted.push(edge);
    }
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
      if (!visited.has(next)) {
        stack.push(next);
      }
    }
  }

  return false;
}

/*
  Remove transitive edges from the accepted acyclic relation graph.

  If A > B and B > C, then A > C is implied and is omitted from the
  Hasse diagram.
*/
function transitiveReduction(edges) {
  const adjacency = new Map(songs.map((song) => [song.id, new Set()]));

  for (const edge of edges) {
    adjacency.get(edge.from).add(edge.to);
  }

  const result = [];

  for (const edge of edges) {
    adjacency.get(edge.from).delete(edge.to);

    const isTransitive = hasPath(adjacency, edge.from, edge.to);

    if (!isTransitive) {
      adjacency.get(edge.from).add(edge.to);
      result.push(edge);
    }
  }

  return result;
}

/* ------------------------------------------------------------------ */
/* Rendering                                                          */
/* ------------------------------------------------------------------ */

function render() {
  renderComparison();
  renderStats();

  const order = buildPartialOrder();
  renderDiagram(order.hasseEdges);
  renderExplanation(order);
}

function renderComparison() {
  if (!activePair) {
    buttonA.innerHTML = `<span class="song-title">All pairs answered</span>`;
    buttonB.innerHTML = `<span class="song-title">Thank you!</span>`;
    setButtonsDisabled(true);
    return;
  }

  const songA = songById.get(activePair.a);
  const songB = songById.get(activePair.b);

  buttonA.innerHTML = songMarkup(songA);
  buttonB.innerHTML = songMarkup(songB);

  buttonA.onclick = () => submitVote(songA.id);
  buttonB.onclick = () => submitVote(songB.id);
  incomparableButton.onclick = () => submitVote("incomparable");
  skipButton.onclick = skipPair;

  setButtonsDisabled(submitting || !db || !uid);
}

function songMarkup(song) {
  return `
    <span class="song-title">${escapeHtml(song.title)}</span>
    <span class="song-artist">${escapeHtml(song.artist)}</span>
  `;
}

function renderStats() {
  const pairs = Object.values(state.pairs || {});

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
  const acceptedCount = order.accepted.length;
  const rejectedCount = order.cycleRejected.length;

  let cycleText;

  if (rejectedCount === 0) {
    cycleText = `
      <p>
        No crowd-supported candidate relation currently conflicts with the
        accepted partial order.
      </p>
    `;
  } else {
    cycleText = `
      <p>
        <strong>${rejectedCount}</strong> weaker relation${
          rejectedCount === 1 ? "" : "s"
        } ${
          rejectedCount === 1 ? "was" : "were"
        } excluded because ${
          rejectedCount === 1 ? "it would" : "they would"
        } create a cycle:
      </p>
      <ul>
        ${order.cycleRejected
          .map((edge) => {
            const preferred = songById.get(edge.from);
            const lessPreferred = songById.get(edge.to);

            return `
              <li>
                ${escapeHtml(preferred.title)} &gt;
                ${escapeHtml(lessPreferred.title)}
              </li>
            `;
          })
          .join("")}
      </ul>
    `;
  }

  explanationElement.innerHTML = `
    <strong>How this partial order is constructed</strong>

    <p>
      A directional relation appears only if one song receives more than half
      of all responses for that pair. Incomparable responses count against
      directional support, so they can prevent an edge from appearing.
    </p>

    <p>
      There ${acceptedCount === 1 ? "is" : "are"} currently
      <strong>${acceptedCount}</strong> accepted crowd-supported relation${
        acceptedCount === 1 ? "" : "s"
      }.
    </p>

    ${cycleText}

    <p>
      To resolve cycles, the app considers the strongest supported relations
      first and refuses any later relation that would create a directed cycle.
      The visible edges are then transitively reduced to form a Hasse diagram.
    </p>
  `;
}

function renderDiagram(edges) {
  svg.selectAll("*").remove();

  const width = 1500;
  const graph = layoutGraph(edges, width);
  const height = Math.max(500, graph.height);

  svg.attr("viewBox", `0 0 ${width} ${height}`);

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

  /*
    An empty edge set is a valid partial order: an antichain.
    Always draw every song node.
  */
  if (edges.length === 0) {
    svg
      .append("text")
      .attr("class", "empty-graph-message")
      .attr("x", width / 2)
      .attr("y", 42)
      .attr("text-anchor", "middle")
      .text(
        "No crowd-supported ordering relations yet — songs are currently separate."
      );
  }

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

  const nodeGroups = svg
    .append("g")
    .selectAll("g")
    .data(songs)
    .join("g")
    .attr("transform", (song) => {
      const position = graph.positions.get(song.id);
      return `translate(${position.x}, ${position.y})`;
    });

  nodeGroups.append("circle").attr("class", "node-circle").attr("r", 18);

  nodeGroups
    .append("text")
    .attr("class", "node-label")
    .attr("x", 28)
    .attr("y", -2)
    .text((song) => song.title);

  nodeGroups
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

  const startY = edges.length === 0 ? 135 : 70;

  for (const [level, levelSongs] of levels) {
    levelSongs.sort((a, b) => a.title.localeCompare(b.title));

    const spacing = width / (levelSongs.length + 1);

    levelSongs.forEach((song, index) => {
      positions.set(song.id, {
        x: spacing * (index + 1),
        y: startY + level * 125,
      });
    });
  }

  return {
    positions,
    height: startY + maxRank * 125 + 130,
  };
}

/* ------------------------------------------------------------------ */
/* Utilities                                                          */
/* ------------------------------------------------------------------ */

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
