import { PortableDoc } from '@portable-doc/react'
import '@portable-doc/react/paper-surface.css'
import React from 'react'
import { createRoot } from 'react-dom/client'

const doc = [{ type: 'heading', level: 1, text: 'Hello PortableDoc' }, { type: 'paragraph', content: [{ type: 'text', value: 'One install. One document. Every surface.' }] }]

createRoot(document.getElementById('root')).render(<PortableDoc value={doc} />)
