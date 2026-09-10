import ReactMarkdown from 'react-markdown'

export default function CoachMarkdown({ children }: { children: string }) {
  return <div className="text-slate-200 space-y-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_strong]:font-semibold">
    <ReactMarkdown skipHtml>{children}</ReactMarkdown>
  </div>
}
