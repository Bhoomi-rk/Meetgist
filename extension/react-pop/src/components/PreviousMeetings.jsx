import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";

const API_URL = "http://localhost:5000/api";

export default function PreviousMeetings() {
  const [meetings, setMeetings] = useState([]);

  useEffect(() => {
    fetch(`${API_URL}/meetings`)
      .then(res => res.json())
      .then(data => setMeetings(data))
      .catch(err => console.log(err));
  }, []);

  return (
    <div style={{padding:"20px"}}>
      <h2>Previous Meetings</h2>
       {/* <button 
   onClick={async ()=>{
      await fetch("http://localhost:5000/api/meetings/clear",{method:"DELETE"});
      alert("All history deleted");
      window.location.reload();
   }}
   style={{background:"red",color:"white",padding:"6px 12px",marginBottom:"10px"}}
>
   Delete All History
</button> */}

      {meetings.length === 0 && <p>No meetings recorded yet...</p>}

      <ul style={{listStyle:"none",padding:0}}>
        {meetings.map(m => (
          <li key={m._id} style={{
            margin:"10px 0",
            padding:"10px",
            border:"1px solid #ccc",
            borderRadius:"8px"
          }}>
            <Link to={`/meeting/${m._id}`} style={{textDecoration:"none"}}>
              <b>{m.title}</b><br/>
              <small>{new Date(m.createdAt).toLocaleString()}</small>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
