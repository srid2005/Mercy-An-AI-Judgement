// Movies & TV -- the video player. Opened from Explorer on a video file.
import React, { useEffect, useRef } from "react";
import { useSelector } from "react-redux";
import { ToolBar } from "../../../utils/general";
import "./assets/video.scss";

export const VideoPlayer = () => {
  const wnapp = useSelector((state) => state.apps.movies);
  const ref = useRef(null);
  const file = wnapp && wnapp.file;

  // pause when the window is closed or minimised
  useEffect(() => {
    if (ref.current && (wnapp.hide || wnapp.max === false)) ref.current.pause();
  }, [wnapp.hide, wnapp.max]);

  if (!wnapp) return null;

  return (
    <div
      className="moviesApp floatTab dpShad"
      data-size={wnapp.size}
      data-max={wnapp.max}
      style={{
        ...(wnapp.size == "cstm" ? wnapp.dim : null),
        zIndex: wnapp.z,
      }}
      data-hide={wnapp.hide}
      id={wnapp.icon + "App"}
    >
      <ToolBar app={wnapp.action} icon={wnapp.icon} size={wnapp.size} name={file ? `${file.name} - Movies & TV` : "Movies & TV"} invert noinvert />
      <div className="windowScreen flex flex-col" data-dock="true">
        <div className="restWindow flex-grow mvBody">
          {file ? (
            <>
              <video key={file.src} ref={ref} src={file.src} controls controlsList="nodownload" preload="metadata" />
              <div className="mvMeta">
                <span className="mvName">{file.name}</span>
                <span className="mvPath">{file.folder}</span>
              </div>
            </>
          ) : (
            <div className="mvEmpty">
              <div className="mvEmptyTitle">Movies & TV</div>
              <div>Open a video from File Explorer.</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
