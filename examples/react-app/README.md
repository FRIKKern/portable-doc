# F05: one-install React app

This is the browser app used for journey F05. Its render source is eight lines,
including blanks, and uses only the public package and CSS entry points.

After `@portable-doc/react@0.1.0-alpha.1` is public, the final proof starts from a fresh
React Vite app and adds PortableDoc with one install command:

```sh
npm create vite@latest portable-doc-demo -- --template react
cd portable-doc-demo
npm i @portable-doc/react@0.1.0-alpha.1
```

Copy [`src/main.jsx`](src/main.jsx) into the fresh app, then run `npm run dev`.

## Candidate rehearsal and GIF

Before publication, rehearse the identical browser render against the reviewed
tarball. The capture refuses an unexpected candidate digest.

```sh
F05_REACT_SOURCE_SHA=976855af9085c6c3840359f79016822adf5c300d \
PORTABLE_DOC_REACT_SPEC=/path/to/portable-doc-react-0.1.0-alpha.1.tgz \
  npm run capture
```

Set `F05_OUTPUT_DIR` to keep evidence outside `docs/images/f05`; set
`F05_CHROME` or `F05_FFMPEG` when those tools are not on their default macOS
paths. The runner creates a disposable app, performs one `npm install`, opens its
real Vite page in headless Chrome, and writes a GIF plus `manifest.json`.

The committed candidate manifest is dry-run evidence, not registry proof. After
publication, rerun with `PORTABLE_DOC_REACT_SPEC=@portable-doc/react@0.1.0-alpha.1` and
commit the replaced GIF and manifest only after independent review.
