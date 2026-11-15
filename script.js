/* PerfectHue-Web: browser-only face sampling and shade matching */
(() => {
  const input = document.getElementById("imageUpload");
  const form = document.getElementById("uploadForm");
  const area = document.querySelector(".upload-area");
  const fileName = document.getElementById("fileName");
  const spinner = document.getElementById("loadingSpinner");
  const status = document.getElementById("statusMessage");
  const submit = document.getElementById("submitButton");
  let selectedImage = null, latest = null, dataset = [];

  const showStatus = (message) => { status.textContent = message; status.style.display = "block"; };
  const hideStatus = () => { status.textContent = ""; status.style.display = "none"; };

  input.addEventListener("change", () => {
    const f = input.files && input.files[0];
    if (!f) return;
    if (!["image/jpeg", "image/png"].includes(f.type)) {
      input.value = ""; fileName.textContent = "Please select a JPG or PNG image."; return;
    }
    if (f.size > 12 * 1024 * 1024) {
      input.value = ""; fileName.textContent = "Please choose an image smaller than 12 MB."; return;
    }
    fileName.textContent = "Selected: " + f.name;
    selectedImage = f;
  });

  area.addEventListener("keydown", e => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.click(); }
  });
  ["dragover", "dragenter"].forEach(ev => area.addEventListener(ev, e => { e.preventDefault(); area.classList.add("drag-active"); }));
  ["dragleave", "drop"].forEach(ev => area.addEventListener(ev, e => { e.preventDefault(); area.classList.remove("drag-active"); }));
  area.addEventListener("drop", e => {
    const f = e.dataTransfer.files[0];
    if (!f) return;
    const transfer = new DataTransfer(); transfer.items.add(f); input.files = transfer.files;
    input.dispatchEvent(new Event("change"));
  });

  function parseCSV(text) {
    const rows = []; let row = [], field = "", quoted = false;
    for (let i=0; i<text.length; i++) {
      const c = text[i], n = text[i+1];
      if (c === '"' && quoted && n === '"') { field += '"'; i++; }
      else if (c === '"') quoted = !quoted;
      else if (c === "," && !quoted) { row.push(field); field = ""; }
      else if ((c === "\n" || c === "\r") && !quoted) {
        if (c === "\r" && n === "\n") i++;
        row.push(field); if (row.some(v => v.trim() !== "")) rows.push(row);
        row = []; field = "";
      } else field += c;
    }
    if (field.length || row.length) { row.push(field); rows.push(row); }
    const headers = rows.shift().map(h => h.trim());
    return rows.map(r => Object.fromEntries(headers.map((h,i) => [h, r[i] ?? ""])));
  }

  async function loadDataset() {
    if (dataset.length) return dataset;
    const response = await fetch("foundation_dataset.csv");
    if (!response.ok) throw new Error("Could not load the foundation dataset. Please refresh the page and try again.");
    dataset = parseCSV(await response.text()).filter(x => [x.R,x.G,x.B].every(v => Number.isFinite(Number(v))));
    if (!dataset.length) throw new Error("The foundation dataset appears to be empty or invalid.");
    return dataset;
  }

  function median(values) {
    values.sort((a,b)=>a-b); const m=Math.floor(values.length/2);
    return values.length % 2 ? values[m] : (values[m-1]+values[m])/2;
  }
  function sampleRegion(ctx, x, y, radius, w, h) {
    const x0=Math.max(0,Math.round(x-radius)), y0=Math.max(0,Math.round(y-radius));
    const x1=Math.min(w,Math.round(x+radius)), y1=Math.min(h,Math.round(y+radius));
    const data=ctx.getImageData(x0,y0,Math.max(1,x1-x0),Math.max(1,y1-y0)).data;
    const channels=[[],[],[]];
    for(let i=0;i<data.length;i+=4) {
      if(data[i+3] < 200) continue;
      channels[0].push(data[i]); channels[1].push(data[i+1]); channels[2].push(data[i+2]);
    }
    if (!channels[0].length) return null;
    return channels.map(median);
  }
  function rgbHex(rgb) { return "#" + rgb.map(v=>Math.round(v).toString(16).padStart(2,"0")).join("").toUpperCase(); }
  function estimateUndertone([r,g,b]) {
    // Lightweight visual estimate only; not a medical or definitive undertone test.
    const warmth = r - b;
    if (warmth > 32 && r >= g) return "Warm";
    if (warmth < 12 && Math.abs(r-g) < 24) return "Cool";
    return "Neutral";
  }
  function closestMatches(rgb, rows) {
    return rows.map(row => ({...row, distance: Math.sqrt(
      (Number(row.R)-rgb[0])**2 + (Number(row.G)-rgb[1])**2 + (Number(row.B)-rgb[2])**2
    )})).sort((a,b)=>a.distance-b.distance).slice(0,3);
  }

  async function detectFace(image) {
    if (!window.FaceMesh) throw new Error("The facial-analysis library did not load. Check your internet connection and refresh.");
    const faceMesh = new FaceMesh({locateFile: file => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`});
    faceMesh.setOptions({maxNumFaces: 2, refineLandmarks: false, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5});
    return new Promise((resolve,reject) => {
      let settled=false;
      faceMesh.onResults(results => {
        if (settled) return; settled=true;
        faceMesh.close();
        const faces=results.multiFaceLandmarks || [];
        if (!faces.length) return reject(new Error("No face detected. Please choose a clear, front-facing photograph."));
        if (faces.length > 1) return reject(new Error("More than one face detected. Please upload a photograph containing only one face."));
        resolve(faces[0]);
      });
      faceMesh.send({image}).catch(err => { if(!settled){settled=true; faceMesh.close(); reject(err);} });
    });
  }

  function makePreview(source, landmarks, rgb, halfOnly) {
    const canvas=document.createElement("canvas"), ctx=canvas.getContext("2d");
    canvas.width=source.naturalWidth; canvas.height=source.naturalHeight;
    ctx.drawImage(source,0,0);
    const w=canvas.width,h=canvas.height;
    const points=[10,338,297,332,284,251,389,356,454,323,361,288,397,365,379,378,400,377,152,148,176,149,150,136,172,58,132,93,234,127,162,21,54,103,67,109]
      .map(i=>landmarks[i]).filter(Boolean);
    if(points.length<10) return canvas.toDataURL("image/jpeg",0.86);
    ctx.save(); ctx.beginPath();
    points.forEach((p,i)=>{const x=p.x*w,y=p.y*h; if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);});
    ctx.closePath(); ctx.clip();
    if(halfOnly){ctx.beginPath();ctx.rect(0,0,w/2,h);ctx.clip();}
    ctx.globalAlpha=0.30; ctx.fillStyle=`rgb(${rgb.map(Math.round).join(",")})`; ctx.fillRect(0,0,w,h);
    ctx.restore();
    return canvas.toDataURL("image/jpeg",0.86);
  }

  function renderResults(file, image, landmarks, skin, matches) {
    const hex=rgbHex(skin), undertone=estimateUndertone(skin);
    document.getElementById("uploadedPreview").src=URL.createObjectURL(file);
    document.getElementById("skinSwatch").style.backgroundColor=hex;
    document.getElementById("skinHex").textContent=hex;
    document.getElementById("skinRgb").textContent=skin.map(Math.round).join(", ");
    document.getElementById("undertone").textContent=undertone;
    document.getElementById("analysisSection").style.display="block";
    document.getElementById("results").style.display="block";
    const list=document.getElementById("shadeList"); list.innerHTML="";
    const outputs=[];
    matches.forEach((shade,index)=>{
      const rgb=[Number(shade.R),Number(shade.G),Number(shade.B)];
      const half=makePreview(image,landmarks,rgb,true), full=makePreview(image,landmarks,rgb,false);
      outputs.push({half,full});
      const card=document.createElement("article"); card.className="shade-card";
      const availability=String(shade.in_india).toLowerCase()==="true" ? "Available in India" : "Availability in India not confirmed";
      card.innerHTML=`
       <span class="shade-number">MATCH 0${index+1}</span>
       <h3></h3><h4 class="shade-name"></h4><p class="shade-product"></p>
       <div class="shade-rgb"><p><strong>Shade RGB Colour</strong></p>
        <p>R: ${rgb[0]} | G: ${rgb[1]} | B: ${rgb[2]}</p><p>HEX: ${escapeHTML(shade.hex || rgbHex(rgb))}</p>
        <div class="shade-colour" style="background:${rgbHex(rgb)}"></div></div>
       <p class="availability ${availability==="Available in India"?"available":"unavailable"}">${availability}</p>
       <div class="preview-container"><div class="preview-grid">
        <div class="preview-item"><p>Half-face preview</p><img alt="Half-face shade preview" src="${half}"></div>
        <div class="preview-item"><p>Full-face preview</p><img alt="Full-face shade preview" src="${full}"></div>
       </div></div>`;
      card.querySelector("h3").textContent=shade.brand;
      card.querySelector(".shade-name").textContent=shade.name;
      card.querySelector(".shade-product").textContent=shade.product;
      list.appendChild(card);
    });
    latest={file,image,skin,hex,undertone,matches,outputs};
    document.getElementById("recommendationsSection").style.display="block";
    document.getElementById("results").scrollIntoView({behavior:"smooth",block:"start"});
  }
  function escapeHTML(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}

  form.addEventListener("submit", async e => {
    e.preventDefault(); hideStatus();
    const file=input.files && input.files[0];
    if(!file){showStatus("Please select a photograph first.");return;}
    spinner.style.display="flex"; submit.disabled=true; submit.textContent="Analysing...";
    document.getElementById("results").style.display="none";
    document.getElementById("analysisSection").style.display="none";
    document.getElementById("recommendationsSection").style.display="none";
    try {
      const rows=await loadDataset();
      const image=new Image();
      const objectURL=URL.createObjectURL(file);
      await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=()=>reject(new Error("Could not open this image. Please try another file."));image.src=objectURL;});
      const max=1000, scale=Math.min(1,max/Math.max(image.naturalWidth,image.naturalHeight));
      const canvas=document.createElement("canvas"); canvas.width=Math.round(image.naturalWidth*scale); canvas.height=Math.round(image.naturalHeight*scale);
      const ctx=canvas.getContext("2d",{willReadFrequently:true}); ctx.drawImage(image,0,0,canvas.width,canvas.height);
      const landmarks=await detectFace(canvas);
      const w=canvas.width,h=canvas.height;
      // Median samples from forehead and both cheek areas, avoiding the eyes and mouth.
      const samplePoints=[ [landmarks[10],0.035], [landmarks[50],0.025], [landmarks[280],0.025], [landmarks[123],0.025], [landmarks[352],0.025] ];
      const samples=samplePoints.map(([p,r])=>p && sampleRegion(ctx,p.x*w,p.y*h,Math.max(4,Math.min(w,h)*r),w,h)).filter(Boolean);
      if(!samples.length) throw new Error("Could not sample skin colour. Please try a clearer, well-lit photograph.");
      const skin=[0,1,2].map(c=>median(samples.map(s=>s[c])));
      const matches=closestMatches(skin,rows);
      // Use original image for display and previews, with landmark coordinates from resized image.
      renderResults(file,image,landmarks,skin,matches);
      URL.revokeObjectURL(objectURL);
    } catch(err) { showStatus(err.message || "Something went wrong. Please try another photograph."); }
    finally { spinner.style.display="none"; submit.disabled=false; submit.textContent="Find My Foundation Match →"; }
  });

  document.getElementById("downloadReport").addEventListener("click", async () => {
    if(!latest) return;
    if(!window.jspdf || !window.jspdf.jsPDF){showStatus("The PDF library did not load. Please check your internet connection and try again.");return;}
    const {jsPDF}=window.jspdf, pdf=new jsPDF();
    pdf.setFont("helvetica","bold");pdf.setFontSize(22);pdf.setTextColor(146,92,105);pdf.text("PerfectHue",20,22);
    pdf.setFont("helvetica","normal");pdf.setFontSize(10);pdf.setTextColor(80,65,72);
    pdf.text("Your personalised foundation shade report",20,30);
    pdf.text(`Detected skin colour: ${latest.hex}`,20,42);
    pdf.text(`RGB: ${latest.skin.map(Math.round).join(", ")}`,20,49);
    pdf.text(`Estimated undertone: ${latest.undertone}`,20,56);
    let y=70;
    latest.matches.forEach((s,i)=>{
      pdf.setFont("helvetica","bold");pdf.text(`${i+1}. ${s.brand} - ${s.name}`,20,y);
      pdf.setFont("helvetica","normal");pdf.text(`${s.product}`,20,y+6);
      pdf.text(`RGB ${s.R}, ${s.G}, ${s.B} | ${s.hex} | ${String(s.in_india).toLowerCase()==="true"?"Available in India":"Availability not confirmed"}`,20,y+12);
      try{pdf.addImage(latest.outputs[i].full,"JPEG",20,y+17,38,38);}catch(e){}
      y+=62;
    });
    pdf.setFontSize(8);pdf.setTextColor(120,110,115);
    pdf.text("Image-based estimates can vary with lighting, makeup and camera settings. Test shades in person when possible.",20,285,{maxWidth:170});
    pdf.save("My_PerfectHue_Results.pdf");
  });
  document.getElementById("startOver").addEventListener("click",()=>{
    latest=null;input.value="";selectedImage=null;fileName.textContent="No image selected";hideStatus();
    document.getElementById("matcher").scrollIntoView({behavior:"smooth"});
  });
})();