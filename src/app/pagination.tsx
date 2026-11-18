import Link from "next/link";
import { ArrowLeft, ArrowRight } from "lucide-react";
import type { ListingPage } from "@/lib/api";

export function ListingPagination({ data, href, label }: {
  data: Omit<ListingPage, "items">; href: (page: number) => string; label: string;
}) {
  return data.pages > 1 && <nav className="list-pagination" aria-label={label}>
    {data.previous_page ? <Link className="secondary-button" href={href(data.previous_page)} scroll={false}><ArrowLeft size={16}/> Previous page</Link> : <span/>}
    <span role="status">Page {data.page} of {data.pages} · {data.count} results</span>
    {data.next_page ? <Link className="secondary-button" href={href(data.next_page)} scroll={false}>Next page <ArrowRight size={16}/></Link> : <span/>}
  </nav>;
}
