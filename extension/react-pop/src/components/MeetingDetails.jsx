import React, { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";

const API_URL = "http://localhost:5000/api";

export default function MeetingDetails() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [meeting, setMeeting] = useState(null);

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

      <h3>Transcript</h3><pre>{meeting.transcript}</pre>

      <h3>Key Points</h3>
      <ul>{meeting.keyPoints?.map((x,i)=><li key={i}>{x}</li>)}</ul>

      <section className="box">
        <h3>Important Images</h3>
          {meeting?.importantImages?.length > 0 ? (
        <div style={{display:"flex",flexWrap:"wrap",gap:"10px"}}>
           {meeting.importantImages.map((img,i)=>(
          <img key={i} src={img} alt="important" style={{width:"200px",borderRadius:"8px"}} />
        ))}
    </div>
     ) : (
    <p>No important images captured.</p>
  )}
</section>


      <button onClick={deleteMeeting} style={{
        background:"red",color:"white",padding:"10px",marginTop:"20px"
      }}>
        Delete Meeting
      </button>
    </div>
  );
}
