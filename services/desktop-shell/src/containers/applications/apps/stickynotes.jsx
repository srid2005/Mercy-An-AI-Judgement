// Notes -- a Sticky-Notes-style app. A list of notes on the left, the open
// note on the right, a search box. Read-only: this is an evidence image.
import React, { useState } from "react";
import { useSelector } from "react-redux";
import { Icon, ToolBar } from "../../../utils/general";
import { NOTES } from "../../../utils/notes";
import "./assets/stickynotes.scss";

export const StickyNotes = () => {
  const wnapp = useSelector((state) => state.apps.notes);
  const [q, setQ] = useState("");
  const [cur, setCur] = useState(NOTES[0].id);
  if (!wnapp) return null;

  const list = NOTES.filter((n) => !q || (n.title + " " + n.body).toLowerCase().includes(q.toLowerCase()));
  const note = NOTES.find((n) => n.id === cur) || list[0];

  return (
    <div
      className="stickyApp floatTab dpShad"
      data-size={wnapp.size}
      data-max={wnapp.max}
      style={{
        ...(wnapp.size == "cstm" ? wnapp.dim : null),
        zIndex: wnapp.z,
      }}
      data-hide={wnapp.hide}
      id={wnapp.icon + "App"}
    >
      <ToolBar app={wnapp.action} icon={wnapp.icon} size={wnapp.size} name="Notes" />
      <div className="windowScreen flex" data-dock="true">
        <div className="snList">
          <div className="snSearch">
            <Icon fafa="faMagnifyingGlass" width={12} />
            <input placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="snItems win11Scroll">
            {list.map((n) => (
              <div key={n.id} className={"snItem prtclk " + n.color + (note && note.id === n.id ? " active" : "")} onClick={() => setCur(n.id)}>
                <div className="snTitle">{n.title}</div>
                <div className="snPreview">{n.body.split("\n")[0]}</div>
                <div className="snWhen">{n.updated}</div>
              </div>
            ))}
            {list.length === 0 ? <div className="snEmpty">No notes match.</div> : null}
          </div>
        </div>
        <div className={"snNote " + (note ? note.color : "yellow")}>
          {note ? (
            <>
              <div className="snNoteHead">
                <span className="snNoteTitle">{note.title}</span>
                <span className="snNoteWhen">Edited {note.updated}</span>
              </div>
              <textarea className="snBody win11Scroll" value={note.body} readOnly spellCheck={false} />
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
};
