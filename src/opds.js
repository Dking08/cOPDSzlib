/**
 * OPDS 1.2 feed generators
 * Produces Atom XML feeds compatible with Readest and other OPDS clients
 */

const OPDS_MIME = 'application/atom+xml;profile=opds-catalog;kind=navigation';
const OPDS_ACQ_MIME = 'application/atom+xml;profile=opds-catalog;kind=acquisition';
const SEARCH_MIME = 'application/opensearchdescription+xml';

const EXTENSION_MIME = {
  epub: 'application/epub+zip',
  mobi: 'application/x-mobipocket-ebook',
  pdf: 'application/pdf',
  azw3: 'application/vnd.amazon.mobi8-ebook',
  djvu: 'image/vnd.djvu',
  fb2: 'application/x-fictionbook+xml',
  txt: 'text/plain',
  rtf: 'application/rtf',
  doc: 'application/msword',
  cbr: 'application/x-cbr',
  cbz: 'application/x-cbz',
};

function escapeXml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Generate the root OPDS navigation catalog
 */
function rootCatalog(baseUrl) {
  const now = new Date().toISOString();

  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom"
      xmlns:opds="http://opds-spec.org/2010/catalog">

  <id>urn:readest-zlib-opds:root</id>
  <title>Z-Library OPDS</title>
  <subtitle>Search and download books from Z-Library via OPDS</subtitle>
  <updated>${now}</updated>
  <author>
    <name>Readest OPDS Bridge</name>
  </author>

  <link rel="self"
        href="${baseUrl}/opds"
        type="${OPDS_MIME}" />

  <link rel="start"
        href="${baseUrl}/opds"
        type="${OPDS_MIME}" />

  <link rel="search"
        href="${baseUrl}/opds/search?q={searchTerms}"
        type="${OPDS_ACQ_MIME}"
        title="Search Z-Library" />

  <link rel="search"
        href="${baseUrl}/opds/opensearch.xml"
        type="${SEARCH_MIME}" />

  <entry>
    <id>urn:readest-zlib-opds:search</id>
    <title>Search Books</title>
    <content type="text">Search Z-Library&apos;s vast collection of books</content>
    <updated>${now}</updated>
    <link rel="subsection"
          href="${baseUrl}/opds/search?q={searchTerms}"
          type="${OPDS_ACQ_MIME}" />
  </entry>

</feed>`;
}

/**
 * Generate the OpenSearch description XML
 */
function openSearchDescription(baseUrl) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<OpenSearchDescription xmlns="http://a9.com/-/spec/opensearch/1.1/">
  <ShortName>Z-Library</ShortName>
  <Description>Search Z-Library books</Description>
  <InputEncoding>UTF-8</InputEncoding>
  <OutputEncoding>UTF-8</OutputEncoding>
  <Url type="${OPDS_ACQ_MIME}"
       template="${baseUrl}/opds/search?q={searchTerms}&amp;page={startPage?}" />
</OpenSearchDescription>`;
}

/**
 * Generate an OPDS acquisition feed from search results
 * @param {Object} opts
 * @param {string} opts.baseUrl - Server base URL
 * @param {string} opts.query - Search query
 * @param {Array} opts.books - Parsed book objects from scraper
 * @param {number} opts.page - Current page number
 */
function searchResultsFeed({ baseUrl, query, books, page }) {
  const now = new Date().toISOString();
  const encodedQuery = escapeXml(encodeURIComponent(query));

  const entries = books
    .map((book) => {
      const mimeType = EXTENSION_MIME[book.extension] || 'application/octet-stream';
      const dlUrl = `${baseUrl}/opds/download${book.download}?ext=${book.extension}`;
      const coverProxy = book.coverUrl
        ? `${baseUrl}/opds/cover?url=${encodeURIComponent(book.coverUrl)}`
        : '';

      // Build a nice summary
      const summaryParts = [];
      if (book.publisher) summaryParts.push(`Publisher: ${book.publisher}`);
      if (book.year && book.year !== '0') summaryParts.push(`Year: ${book.year}`);
      if (book.language) summaryParts.push(`Language: ${book.language}`);
      if (book.filesize) summaryParts.push(`Size: ${book.filesize}`);
      if (book.extension) summaryParts.push(`Format: ${book.extension.toUpperCase()}`);
      if (book.rating && book.rating !== '0.0') summaryParts.push(`Rating: ${book.rating}/5`);
      const summary = summaryParts.join(' | ');

      return `
  <entry>
    <id>urn:zlib:book:${escapeXml(book.id)}</id>
    <title>${escapeXml(book.title)}</title>
    <author>
      <name>${escapeXml(book.author)}</name>
    </author>
    <updated>${now}</updated>
    <summary type="text">${escapeXml(summary)}</summary>
    ${book.isbn ? `<dc:identifier>urn:isbn:${escapeXml(book.isbn)}</dc:identifier>` : ''}
    ${book.publisher ? `<dc:publisher>${escapeXml(book.publisher)}</dc:publisher>` : ''}
    ${book.language ? `<dc:language>${escapeXml(book.language)}</dc:language>` : ''}
    ${book.year && book.year !== '0' ? `<dc:date>${escapeXml(book.year)}</dc:date>` : ''}
    ${coverProxy ? `<link rel="http://opds-spec.org/image" href="${coverProxy}" type="image/jpeg" />` : ''}
    ${coverProxy ? `<link rel="http://opds-spec.org/image/thumbnail" href="${coverProxy}" type="image/jpeg" />` : ''}
    <link rel="http://opds-spec.org/acquisition"
          href="${escapeXml(dlUrl)}"
          type="${mimeType}"
          title="Download ${escapeXml(book.extension.toUpperCase())} (${escapeXml(book.filesize)})" />
  </entry>`;
    })
    .join('\n');

  const nextPage = books.length >= 10 ? page + 1 : null;

  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom"
      xmlns:dc="http://purl.org/dc/terms/"
      xmlns:opds="http://opds-spec.org/2010/catalog"
      xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/">

  <id>urn:readest-zlib-opds:search:${encodedQuery}:${page}</id>
  <title>Search: ${escapeXml(query)}</title>
  <updated>${now}</updated>
  <author>
    <name>Z-Library OPDS</name>
  </author>

  <opensearch:totalResults>${books.length}</opensearch:totalResults>
  <opensearch:startIndex>${(page - 1) * 50 + 1}</opensearch:startIndex>
  <opensearch:itemsPerPage>50</opensearch:itemsPerPage>

  <link rel="self"
        href="${baseUrl}/opds/search?q=${encodedQuery}&amp;page=${page}"
        type="${OPDS_ACQ_MIME}" />

  <link rel="start"
        href="${baseUrl}/opds"
        type="${OPDS_MIME}" />

  <link rel="search"
        href="${baseUrl}/opds/opensearch.xml"
        type="${SEARCH_MIME}" />

  ${
    nextPage
      ? `<link rel="next" href="${baseUrl}/opds/search?q=${encodedQuery}&amp;page=${nextPage}" type="${OPDS_ACQ_MIME}" />`
      : ''
  }
${entries}

</feed>`;
}

module.exports = {
  rootCatalog,
  openSearchDescription,
  searchResultsFeed,
  OPDS_MIME,
  OPDS_ACQ_MIME,
  SEARCH_MIME,
};
