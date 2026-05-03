# Graph Report - .  (2026-04-17)

## Corpus Check
- 10 files · ~8,235 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 58 nodes · 101 edges · 10 communities detected
- Extraction: 76% EXTRACTED · 24% INFERRED · 0% AMBIGUOUS · INFERRED: 24 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Community 0|Community 0]]
- [[_COMMUNITY_Community 1|Community 1]]
- [[_COMMUNITY_Community 2|Community 2]]
- [[_COMMUNITY_Community 3|Community 3]]
- [[_COMMUNITY_Community 4|Community 4]]
- [[_COMMUNITY_Community 5|Community 5]]
- [[_COMMUNITY_Community 6|Community 6]]
- [[_COMMUNITY_Community 7|Community 7]]
- [[_COMMUNITY_Community 8|Community 8]]
- [[_COMMUNITY_Community 9|Community 9]]

## God Nodes (most connected - your core abstractions)
1. `triggerAnalysis()` - 9 edges
2. `handleCollectPhase()` - 8 edges
3. `generateProjections()` - 8 edges
4. `chat()` - 7 edges
5. `handleFreeformPhase()` - 6 edges
6. `formatINR()` - 6 edges
7. `handleMessage()` - 5 edges
8. `forceAnalyze()` - 5 edges
9. `getSession()` - 5 edges
10. `updateSession()` - 5 edges

## Surprising Connections (you probably didn't know these)
- `displayValue()` --calls--> `formatINR()`  [INFERRED]
  src\controllers\chatController.js → src\services\finance.js
- `isOffTopic()` --calls--> `chat()`  [INFERRED]
  src\controllers\chatController.js → src\services\groq.js
- `handleMessage()` --calls--> `addMessage()`  [INFERRED]
  src\controllers\chatController.js → src\services\sessionStore.js
- `handleCollectPhase()` --calls--> `chat()`  [INFERRED]
  src\controllers\chatController.js → src\services\groq.js
- `triggerAnalysis()` --calls--> `updateSession()`  [INFERRED]
  src\controllers\chatController.js → src\services\sessionStore.js

## Communities

### Community 0 - "Community 0"
Cohesion: 0.27
Nodes (13): get(), buildStepMeta(), displayValue(), forceAnalyze(), getMissingFields(), getSessionState(), handleCollectPhase(), handleFreeformPhase() (+5 more)

### Community 1 - "Community 1"
Cohesion: 0.42
Nodes (10): buildHookLine(), buildInsights(), buildQuickWins(), estimateGoalTimeline(), formatCrLakh(), formatINR(), futureValue(), generateProjections() (+2 more)

### Community 2 - "Community 2"
Cohesion: 0.32
Nodes (6): deleteSessionHandler(), startSession(), addMessage(), createNewSession(), createSession(), deleteSession()

### Community 3 - "Community 3"
Cohesion: 0.4
Nodes (2): run(), test()

### Community 4 - "Community 4"
Cohesion: 0.5
Nodes (4): sanitiseAnalysis(), triggerAnalysis(), buildAnalysisUserMessage(), buildProfileContext()

### Community 5 - "Community 5"
Cohesion: 0.4
Nodes (0): 

### Community 6 - "Community 6"
Cohesion: 0.7
Nodes (4): chat(), chatJSON(), DEFAULT_MODEL(), getClient()

### Community 7 - "Community 7"
Cohesion: 1.0
Nodes (0): 

### Community 8 - "Community 8"
Cohesion: 1.0
Nodes (0): 

### Community 9 - "Community 9"
Cohesion: 1.0
Nodes (0): 

## Knowledge Gaps
- **Thin community `Community 7`** (2 nodes): `gracefulShutdown()`, `server.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 8`** (1 nodes): `Lead.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 9`** (1 nodes): `chat.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `triggerAnalysis()` connect `Community 4` to `Community 0`, `Community 1`, `Community 6`?**
  _High betweenness centrality (0.222) - this node is a cross-community bridge._
- **Why does `updateSession()` connect `Community 0` to `Community 2`, `Community 4`?**
  _High betweenness centrality (0.171) - this node is a cross-community bridge._
- **Why does `get()` connect `Community 0` to `Community 2`, `Community 3`?**
  _High betweenness centrality (0.160) - this node is a cross-community bridge._
- **Are the 5 inferred relationships involving `triggerAnalysis()` (e.g. with `updateSession()` and `buildAnalysisUserMessage()`) actually correct?**
  _`triggerAnalysis()` has 5 INFERRED edges - model-reasoned connections that need verification._
- **Are the 2 inferred relationships involving `handleCollectPhase()` (e.g. with `chat()` and `updateSession()`) actually correct?**
  _`handleCollectPhase()` has 2 INFERRED edges - model-reasoned connections that need verification._
- **Are the 2 inferred relationships involving `generateProjections()` (e.g. with `triggerAnalysis()` and `sanitiseAnalysis()`) actually correct?**
  _`generateProjections()` has 2 INFERRED edges - model-reasoned connections that need verification._
- **Are the 3 inferred relationships involving `chat()` (e.g. with `isOffTopic()` and `handleCollectPhase()`) actually correct?**
  _`chat()` has 3 INFERRED edges - model-reasoned connections that need verification._