import React from "react";

export default function SummaryView({ meeting, onDelete }) {
  if (!meeting) {
    return (
      <div className="card">
        <p>No meeting data available.</p>
      </div>
    );
  }

  const {
    _id,
    title = "Meeting Summary",
    startedAt,
    endedAt,
    summary = "No summary available yet.",
    actionItems = [],
    keyPoints = [],
    sentiment = {},
    urgencyScore = 0,
    transcript = "",
    diarization = { speakers: [], totalSpeakers: 0, segments: [] },
    audioFeatures = {},
    visualFrames = [],
    speakerAnalysis = {},
    priorityTasks = [],
    deadlines = []
  } = meeting;

  // Calculate meeting duration
  const duration = startedAt
    ? Math.round(((endedAt ? new Date(endedAt) : new Date()) - new Date(startedAt)) / 60000)
    : 0;

  // Format date and time
  const formatDate = (dateString) => {
    if (!dateString) return 'N/A';
    const date = new Date(dateString);
    return date.toLocaleString();
  };

  // Get speaker analysis data
  const speakers = speakerAnalysis?.speakers || [];
  const engagementScore = speakerAnalysis?.engagementScore || 0;

  return (
    <div className="meeting-summary">
      {/* Header Section */}
      <div className="meeting-header">
        <h2>{title}</h2>
        <div className="meeting-meta">
          <span>📅 {formatDate(startedAt)}</span>
          <span>⏱️ {duration} minutes</span>
          {sentiment.overall && (
            <span className={`sentiment-${sentiment.overall.toLowerCase()}`}>
              {sentiment.overall} Sentiment
            </span>
          )}
          <span className={`engagement-${Math.floor(engagementScore / 20)}`}>
            {engagementScore}% Engagement
          </span>
        </div>
      </div>

      {/* Summary Section */}
      <div className="summary-section">
        <h3>📋 Meeting Summary</h3>
        <p className="summary-text">{summary || transcript.substring(0, 300) + '...'}</p>
      </div>

      {/* Key Points */}
      {keyPoints.length > 0 && (
        <div className="key-points">
          <h3>🔑 Key Points Discussed</h3>
          <ul>
            {keyPoints.map((point, i) => (
              <li key={i}>
                <span className="point-text">{point.text || point}</span>
                {point.speaker && (
                  <span className="point-speaker">— {point.speaker}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Priority Tasks */}
      {priorityTasks.length > 0 && (
        <div className="priority-tasks">
          <h3>🚨 High Priority Items</h3>
          <div className="task-grid">
            {priorityTasks.map((task, i) => (
              <div key={i} className="task-card">
                <div className="task-header">
                  <span className="task-priority">{task.priority}</span>
                  {task.deadline && (
                    <span className="task-deadline">
                      ⏰ {new Date(task.deadline).toLocaleDateString()}
                    </span>
                  )}
                </div>
                <p className="task-description">{task.description || task.text}</p>
                {task.owner && (
                  <div className="task-owner">
                    <span className="owner-label">Owner:</span>
                    <span className="owner-name">{task.owner}</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Action Items */}
      {actionItems.length > 0 && (
        <div className="action-items">
          <h3>📝 Action Items</h3>
          <ul className="action-list">
            {actionItems.map((item, i) => (
              <li key={i} className="action-item">
                <input type="checkbox" id={`action-${i}`} />
                <label htmlFor={`action-${i}`}>
                  <span className="action-text">{item.text}</span>
                  {item.owner && (
                    <span className="action-owner">@{item.owner}</span>
                  )}
                  {item.due && (
                    <span className="action-due">
                      Due: {new Date(item.due).toLocaleDateString()}
                    </span>
                  )}
                </label>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Speaker Analysis */}
      {speakers.length > 0 && (
        <div className="speaker-analysis">
          <h3>🗣️ Speaker Analysis</h3>
          <div className="speakers-grid">
            {speakers.map((speaker, i) => (
              <div key={i} className="speaker-card">
                <div className="speaker-header">
                  <span className="speaker-name">{speaker.name || `Speaker ${i + 1}`}</span>
                  <span className="speaker-role">{speaker.role || 'Participant'}</span>
                </div>
                <div className="speaker-stats">
                  <div className="stat">
                    <span className="stat-label">Talk Time:</span>
                    <span className="stat-value">{speaker.talkTime || 0}%</span>
                  </div>
                  <div className="stat">
                    <span className="stat-label">Engagement:</span>
                    <span className="stat-value">{speaker.engagement || 0}%</span>
                  </div>
                </div>
                {speaker.keyPoints && speaker.keyPoints.length > 0 && (
                  <div className="speaker-key-points">
                    <div className="key-points-title">Key Contributions:</div>
                    <ul>
                      {speaker.keyPoints.slice(0, 3).map((point, j) => (
                        <li key={j}>{point}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Deadlines */}
      {deadlines && deadlines.length > 0 && (
        <div className="deadlines">
          <h3>⏳ Upcoming Deadlines</h3>
          <ul className="deadline-list">
            {deadlines
              .sort((a, b) => new Date(a.date) - new Date(b.date))
              .map((deadline, i) => (
                <li key={i} className="deadline-item">
                  <div className="deadline-date">
                    {new Date(deadline.date).toLocaleDateString()}
                  </div>
                  <div className="deadline-content">
                    <div className="deadline-title">{deadline.title}</div>
                    {deadline.description && (
                      <div className="deadline-description">{deadline.description}</div>
                    )}
                    {deadline.owner && (
                      <div className="deadline-owner">Owner: {deadline.owner}</div>
                    )}
                  </div>
                </li>
              ))}
          </ul>
        </div>
      )}

      {/* Diarization */}
      {diarization && diarization.totalSpeakers > 0 && (
        <div className="speaker-info">
          <strong>👥 Speakers:</strong> {diarization.totalSpeakers}
          {diarization.speakers && diarization.speakers.length > 0 && (
            <span className="speaker-list">
              {" "}({diarization.speakers.join(", ")})
            </span>
          )}
        </div>
      )}

      {/* Audio Features */}
      {audioFeatures && Object.keys(audioFeatures).length > 0 && (
        <div className="audio-features">
          <strong>🎵 Audio Analysis:</strong>
          <div className="feature-grid">
            {audioFeatures.speakingRate && (
              <span>Rate: {audioFeatures.speakingRate.toFixed(1)} w/s</span>
            )}
            {audioFeatures.pitch && (
              <span>Pitch: {audioFeatures.pitch.toFixed(0)} Hz</span>
            )}
            {audioFeatures.energy && (
              <span>Energy: {audioFeatures.energy.toFixed(3)}</span>
            )}
          </div>
        </div>
      )}

      {/* Sentiment */}
      {sentiment && (
        <div className="sentiment">
          <strong>Sentiment:</strong>{" "}
          <span
            style={{
              color:
                sentiment === "positive"
                  ? "green"
                  : sentiment === "negative"
                    ? "red"
                    : "gray",
              fontWeight: "bold"
            }}
          >
            {sentiment.overall || sentiment}
            {sentiment.score && ` (${(sentiment.score * 100).toFixed(0)}%)`}
          </span>
        </div>
      )}

      {/* Visual Frames */}
      {visualFrames && visualFrames.length > 0 && (
        <div className="visual-section">
          <h4>🎬 Key Visual Frames</h4>
          <div className="visual-frames">
            {visualFrames.slice(0, 5).map((frame, i) => (
              <div key={i} className="frame-card">
                <img
                  src={frame.url}
                  alt={`Frame ${i + 1}`}
                  className="frame-thumb"
                />
                <div className="frame-info">
                  {frame.isScreenshare && <span className="badge">📊 Screenshare</span>}
                  {frame.relevanceScore && (
                    <span className="relevance">Relevance: {(frame.relevanceScore * 100).toFixed(0)}%</span>
                  )}
                  {frame.timestamp && (
                    <span className="timestamp">{frame.timestamp.toFixed(1)}s</span>
                  )}
                </div>
                {frame.ocrText && frame.ocrText.length > 0 && (
                  <p className="frame-ocr">{frame.ocrText.substring(0, 100)}...</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Urgency Score and Delete Button */}
      <div className="footer-actions">
        <div className="urgency">
          <strong>Urgency Score:</strong>{" "}
          <span
            style={{
              color: urgencyScore > 7
                ? "red"
                : urgencyScore > 4
                  ? "orange"
                  : "green",
            }}
          >
            {urgencyScore ? urgencyScore.toFixed(2) : "0.00"}
          </span>
        </div>
        {onDelete && (
          <button
            className="delete-btn"
            onClick={() => onDelete(_id)}
            aria-label="Delete summary"
          >
            🗑️ Delete Summary
          </button>
        )}
      </div>
    </div>
  );
}