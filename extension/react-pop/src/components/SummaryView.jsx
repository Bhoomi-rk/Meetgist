import React from "react";

/**
 * SummaryView Component
 * Displays detailed information about a specific meeting summary.
 * Props:
 *  - meeting: meeting object (contains title, summary, actionItems, etc.)
 *  - onDelete: function to delete a meeting
 */

export default function SummaryView({ meeting, onDelete }) {
  if (!meeting || !meeting.summary) {
    return (
      <div className="card">
        <p style={{ color: "#6b7280" }}>No summary available yet.</p>
      </div>
    );
  }

  const { 
    _id, 
    title, 
    date, 
    summary, 
    actionItems, 
    importantImages, 
    urgencyScore,
    sentiment,
    sentimentScore,
    diarization,
    visualFrames,
    audioFeatures,
    multimodalSummary
  } = meeting;
  
  // Parse multimodal summary if it's a string
  let multimodalInsights = {};
  if (multimodalSummary) {
    try {
      multimodalInsights = typeof multimodalSummary === 'string' 
        ? JSON.parse(multimodalSummary) 
        : multimodalSummary;
    } catch (e) {
      console.warn('Failed to parse multimodal summary:', e);
    }
  }

  return (
    <div className="card summary-view">
      <h3>{title || "Untitled Meeting"}</h3>
      <p className="meta">
        {date ? new Date(date).toLocaleString() : "Date not available"}
      </p>

      <p className="summary-text">{summary}</p>

      {importantImages && importantImages.length > 0 && (
        <>
          <h4>📸 Important Images</h4>
          <div className="images">
            {importantImages.map((url, i) => (
              <img
                key={i}
                src={url}
                alt={`Important ${i + 1}`}
                className="thumb"
              />
            ))}
          </div>
        </>
      )}

      {actionItems && actionItems.length > 0 && (
        <>
          <h4>📝 Action Items</h4>
          <ul className="action-list">
            {actionItems.map((a, i) => (
              <li key={i} className="action-item">
                <span>{typeof a === "string" ? a : a.text}</span>
                {a.owner && <span className="owner"> — {a.owner}</span>}
                {a.due && (
                  <span className="due">
                    ⏰ Due: {new Date(a.due).toLocaleDateString()}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </>
      )}

      {/* Multimodal Insights */}
      {multimodalInsights && Object.keys(multimodalInsights).length > 0 && (
        <>
          <h4>🔍 Multi-Modal Insights</h4>
          {multimodalInsights.key_visuals && (
            <div className="insight-section">
              <strong>Key Visuals:</strong>
              <p>{multimodalInsights.key_visuals}</p>
            </div>
          )}
          {multimodalInsights.speaker_dynamics && (
            <div className="insight-section">
              <strong>Speaker Dynamics:</strong>
              <p>{multimodalInsights.speaker_dynamics}</p>
            </div>
          )}
          {multimodalInsights.emotional_tone && (
            <div className="insight-section">
              <strong>Emotional Tone:</strong>
              <p>{multimodalInsights.emotional_tone}</p>
            </div>
          )}
          {multimodalInsights.urgency_indicators && (
            <div className="insight-section">
              <strong>Urgency Indicators:</strong>
              <p>{multimodalInsights.urgency_indicators}</p>
            </div>
          )}
        </>
      )}

      {/* Speaker Information */}
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
      {audioFeatures && (
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
            {sentiment}
            {sentimentScore && ` (${(sentimentScore * 100).toFixed(0)}%)`}
          </span>
        </div>
      )}

      {/* Enhanced Visual Frames */}
      {visualFrames && visualFrames.length > 0 && (
        <>
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
        </>
      )}

      <div className="urgency">
        <strong>Urgency Score:</strong>{" "}
        <span
          style={{
            color:
              urgencyScore > 7
                ? "red"
                : urgencyScore > 4
                ? "orange"
                : "green",
          }}
        >
          {urgencyScore ? urgencyScore.toFixed(2) : "0.00"}
        </span>
      </div>

      <button className="delete-btn" onClick={() => onDelete(_id)}>
        🗑️ Delete Summary
      </button>
    </div>
  );
}
