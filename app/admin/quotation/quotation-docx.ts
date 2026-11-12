import { strToU8, zipSync } from 'fflate';

type QuoteDocumentData = {
  quoteNumber: string | null;
  customerName: string;
  customerContact: string;
  productName: string;
  createdAt: string;
  quote: {
    quantity: number;
    unitPrice: number;
    programFee: number;
    subtotal: number;
    discount: number;
    total: number;
    deposit: number;
    balance: number;
    paymentTerms: string;
    signatory: { name: string; title: string };
  };
  terms: readonly string[];
  paymentDetails: readonly string[];
};

function xml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&apos;',
  })[character] || character);
}

function paragraph(value: string, style?: string) {
  const properties = style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : '';
  return `<w:p>${properties}<w:r><w:t xml:space="preserve">${xml(value)}</w:t></w:r></w:p>`;
}

function tableRow(label: string, value: string, bold = false) {
  const runProperties = bold ? '<w:rPr><w:b/></w:rPr>' : '';
  const cell = (text: string) => `<w:tc><w:tcPr><w:tcW w:w="4500" w:type="dxa"/></w:tcPr><w:p><w:r>${runProperties}<w:t xml:space="preserve">${xml(text)}</w:t></w:r></w:p></w:tc>`;
  return `<w:tr>${cell(label)}${cell(value)}</w:tr>`;
}

function currency(value: number) {
  return `PHP ${value.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function createFormalQuoteDocx(data: QuoteDocumentData) {
  const description = data.productName.trim() || 'Customized garment';
  const rows = [
    tableRow('Description', description, true),
    tableRow('Quantity', `${data.quote.quantity} pieces`),
    tableRow('Unit price', currency(data.quote.unitPrice)),
    ...(data.quote.programFee > 0 ? [tableRow('Embroidery digitizing / program fee', currency(data.quote.programFee))] : []),
    tableRow('Subtotal', currency(data.quote.subtotal)),
    ...(data.quote.discount > 0 ? [tableRow('Discount', `-${currency(data.quote.discount)}`)] : []),
    tableRow('Total', currency(data.quote.total), true),
    tableRow('Deposit (50%)', currency(data.quote.deposit)),
    tableRow('Balance', currency(data.quote.balance)),
  ].join('');
  const terms = data.terms.map((term, index) => paragraph(`${index + 1}. ${term}`)).join('');
  const paymentDetails = data.paymentDetails.map((detail) => paragraph(detail)).join('');
  const document = [
    paragraph('MICHAEL JEFFREY INTERNATIONAL CORPORATION', 'Title'),
    paragraph('Custom Jackets and more'),
    paragraph('CG Venezuela Enterprises · Create. Enhance. and Sustain.'),
    paragraph('22 Bayabas St., Elmar’s Subdivision, Cupang, Antipolo City'),
    paragraph(`FORMAL QUOTATION${data.quoteNumber ? ` · ${data.quoteNumber}` : ''}`, 'Heading1'),
    paragraph(`Prepared for: ${data.customerName}`),
    ...(data.customerContact ? [paragraph(`Contact: ${data.customerContact}`)] : []),
    paragraph(`Date: ${new Date(data.createdAt).toLocaleDateString('en-PH')} · Valid for 30 days`),
    `<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="0" w:type="auto"/></w:tblPr><w:tblGrid><w:gridCol w:w="4500"/><w:gridCol w:w="4500"/></w:tblGrid>${rows}</w:tbl>`,
    paragraph(`Payment terms: ${data.quote.paymentTerms}`, 'Heading2'),
    paragraph('General Terms and Conditions', 'Heading2'),
    terms,
    paragraph('For Payment', 'Heading2'),
    paymentDetails,
    paragraph('Approved by', 'Heading2'),
    paragraph(data.quote.signatory.name),
    paragraph(data.quote.signatory.title),
  ].join('');

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>${document}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1080" w:right="1080" w:bottom="1080" w:left="1080"/></w:sectPr></w:body></w:document>`;
  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="20"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:rPr><w:b/><w:color w:val="0B1E3D"/><w:sz w:val="30"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:rPr><w:b/><w:color w:val="B8912F"/><w:sz w:val="26"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:rPr><w:b/><w:color w:val="0B1E3D"/><w:sz w:val="22"/></w:rPr></w:style><w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4" w:color="B8C0CC"/><w:left w:val="single" w:sz="4" w:color="B8C0CC"/><w:bottom w:val="single" w:sz="4" w:color="B8C0CC"/><w:right w:val="single" w:sz="4" w:color="B8C0CC"/><w:insideH w:val="single" w:sz="4" w:color="B8C0CC"/><w:insideV w:val="single" w:sz="4" w:color="B8C0CC"/></w:tblBorders></w:tblPr></w:style></w:styles>`;

  return zipSync({
    '[Content_Types].xml': strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>'),
    '_rels/.rels': strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'),
    'word/document.xml': strToU8(documentXml),
    'word/styles.xml': strToU8(stylesXml),
  });
}
