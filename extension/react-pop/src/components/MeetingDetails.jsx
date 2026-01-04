import React, { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";

const API_URL = "http://localhost:5000/api";

export default function MeetingDetails() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [meeting, setMeeting] = useState(null);
  const [selectedImage, setSelectedImage] = useState(null);


  useEffect(() => {
    fetch(`${API_URL}/meetings/${id}`)
      .then(res => res.json())
      .then(data => setMeeting(data))
      .catch(err => console.log(err));
  }, [id]);

  const deleteMeeting = async () => {
    await fetch(`${API_URL}/meetings/${id}`, { method: "DELETE" });
    alert("Meeting deleted");
    navigate("/previous");
  };

  if (!meeting) return <p>Loading...</p>;

  return (
    <div style={{padding:"20px"}}>
      <h2>{meeting.title}</h2>
      <p><b>Date:</b> {new Date(meeting.createdAt).toLocaleString()}</p>

      <h3>Summary</h3><p>{meeting.summary}</p>

      <h3>Key Points</h3>
      <ul>{meeting.keyPoints?.map((x,i)=><li key={i}>{x}</li>)}</ul>
      <section className="box">
        <h3>Urgent notifications</h3>
        <ul>{meeting.urgentSentences?.map((x,i)=><li key={i}>{x}</li>)}</ul>
      </section>
      <section className="box">
        <h3>Important Images</h3>
         {meeting.importantImages.map((img, i) => (
  <img
    key={i}
    src={img}
    alt="important"
    style={{
      width: "200px",
      borderRadius: "8px",
      cursor: "pointer",
      border: "2px solid #eee"
    }}
    onClick={() => setSelectedImage(img)}   // 👈 OPEN IMAGE
  />
))}

</section>


      <button onClick={deleteMeeting} style={{
        background:"red",color:"white",padding:"10px",marginTop:"20px"
      }}>
        Delete Meeting
      </button>
      {selectedImage && (
  <div
    onClick={() => setSelectedImage(null)}
    style={{
      position: "fixed",
      top: 0,
      left: 0,
      width: "100vw",
      height: "100vh",
      background: "rgba(0,0,0,0.85)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      zIndex: 9999
    }}
  >
    <img
      src={selectedImage}
      alt="Full View"
      style={{
        maxWidth: "90%",
        maxHeight: "90%",
        borderRadius: "10px",
        boxShadow: "0 0 25px black"
      }}
      onClick={(e) => e.stopPropagation()} // prevent close on image click
    />

    <button
      onClick={() => setSelectedImage(null)}
      style={{
        position: "absolute",
        top: 20,
        right: 30,
        fontSize: "24px",
        background: "transparent",
        color: "white",
        border: "none",
        cursor: "pointer"
      }}
    >
      ✕
    </button>
  </div>
)}

    </div>
  );
}
