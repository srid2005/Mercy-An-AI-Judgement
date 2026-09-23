// Photos -- the image viewer. Opened from Explorer on a picture (with the
// pictures of that folder as prev/next), or from the desktop icon, where it
// shows the Camera Roll gallery. Hidden folders never appear in the gallery.
import React, { useState, useEffect } from "react";
import { useSelector, useDispatch } from "react-redux";
import { Icon, ToolBar } from "../../../utils/general";
import { reportEvidenceIds } from "../../../actions";
import "./assets/photos.scss";

const collect = (item, out, path) => {
  if (!item) return out;
  if (item.info && item.info.hidden) return out;
  if (item.type === "img") out.push({ name: item.name, src: item.data, folder: path, evidence_id: item.info && item.info.evidence_id });
  else if (item.type === "folder" && item.data) item.data.forEach((c) => collect(c, out, path + "\\" + item.name));
  return out;
};

export const Photos = () => {
  const wnapp = useSelector((state) => state.apps.photos);
  const files = useSelector((state) => state.files);
  const dispatch = useDispatch();
  const [idx, setIdx] = useState(0);
  const [file, setFile] = useState(null);
  const pending = wnapp && wnapp.file;

  // a new open from Explorer replaces whatever was showing
  useEffect(() => {
    if (pending) {
      setFile(pending);
      const i = (pending.list || []).findIndex((x) => x.name === pending.name);
      setIdx(i < 0 ? 0 : i);
    }
  }, [pending]);
  const list = file ? file.list || [{ name: file.name, src: file.src, evidence_id: file.evidence_id }] : [];
  const cur = file ? list[idx] || { name: file.name, src: file.src, evidence_id: file.evidence_id } : null;

  // every picture actually shown counts as seen -- including the ones
  // reached with the arrows or from the gallery, which Explorer never opened
  useEffect(() => {
    if (cur && cur.evidence_id) reportEvidenceIds([cur.evidence_id]);
  }, [cur && cur.src]);
  if (!wnapp) return null;

  const pictures = files.data.getId(files.data.special["%pictures%"]);
  const gallery = collect(pictures, [], "C:\\Users\\Meera");
  const prev = () => setIdx((i) => (i - 1 + list.length) % list.length);
  const next = () => setIdx((i) => (i + 1) % list.length);

  // closing the window forgets the file: the desktop icon reopens on the
  // gallery, not on whatever was last opened out of a hidden folder. A later
  // PHOTOSOPEN still wins -- it dispatches a fresh payload that re-fires the
  // effect above.
  useEffect(() => {
    if (wnapp && wnapp.hide) setFile(null);
  }, [wnapp && wnapp.hide]);

  return (
    <div
      className="photosApp floatTab dpShad"
      data-size={wnapp.size}
      data-max={wnapp.max}
      style={{
        ...(wnapp.size == "cstm" ? wnapp.dim : null),
        zIndex: wnapp.z,
      }}
      data-hide={wnapp.hide}
      id={wnapp.icon + "App"}
    >
      <ToolBar app={wnapp.action} icon={wnapp.icon} size={wnapp.size} name="Photos" />
      <div className="windowScreen flex flex-col" data-dock="true">
        <div className="phTop flex items-center">
          {cur ? (
            <>
              <div className="phBack prtclk" onClick={() => setFile(null)}>
                <Icon fafa="faChevronLeft" width={10} /> <span>All photos</span>
              </div>
              {/* the file name lives here and nowhere else: the title bar says
                  "Photos" and there is no caption, so it cannot be drawn twice */}
              <div className="phName" title={cur.name}>
                {cur.name}
              </div>
              <div className="phPath" title={file.folder}>
                {file.folder}
              </div>
              <div className="phCount">
                {idx + 1} / {list.length}
              </div>
            </>
          ) : (
            <>
              <div className="phTitle">Collection</div>
              <div className="phPath">Pictures · {gallery.length} items</div>
            </>
          )}
        </div>
        <div className="restWindow flex-grow phBody">
          {cur ? (
            <div className="phViewer">
              {list.length > 1 ? (
                <div className="phNav left prtclk" onClick={prev}>
                  <Icon fafa="faChevronLeft" width={14} />
                </div>
              ) : null}
              <img src={cur.src} alt={cur.name} />
              {list.length > 1 ? (
                <div className="phNav right prtclk" onClick={next}>
                  <Icon fafa="faChevronRight" width={14} />
                </div>
              ) : null}
            </div>
          ) : (
            <div className="phGallery win11Scroll">
              {gallery.length === 0 ? <div className="phEmpty">No photos in Pictures.</div> : null}
              {gallery.map((g, i) => (
                <div
                  key={i}
                  className="phThumb prtclk"
                  onClick={() => {
                    setFile({ name: g.name, src: g.src, folder: g.folder, list: gallery.filter((x) => x.folder === g.folder) });
                    setIdx(gallery.filter((x) => x.folder === g.folder).findIndex((x) => x.name === g.name));
                  }}
                >
                  <img src={g.src} alt={g.name} loading="lazy" />
                  <span>{g.name}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
