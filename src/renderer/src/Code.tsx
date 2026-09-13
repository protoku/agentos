import { useEffect, useState } from "react";
import CodeMirror, { type Extension } from "@uiw/react-codemirror";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { languages } from "@codemirror/language-data";

/** The two the tool editor writes, kept loaded: everything else is fetched when a file needs it. */
const written: Record<string, Extension> = { javascript: javascript(), json: json() };

/** Enough of an editor to write in, without the machinery a whole file would ask for. */
const setup = { foldGutter: false, autocompletion: false, searchKeymap: false };

export function Code({
	value,
	language,
	onChange,
}: {
	value: string;
	language: string;
	onChange: (value: string) => void;
}) {
	const colouring = useLanguage(language);

	return (
		<div
			data-slot="code"
			className="overflow-hidden rounded-lg border border-input font-mono text-xs focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 dark:bg-input/30"
		>
			<CodeMirror
				value={value}
				theme="dark"
				minHeight="20rem"
				extensions={colouring === undefined ? [] : [colouring]}
				basicSetup={setup}
				onChange={onChange}
			/>
		</div>
	);
}

/** A language the editor already holds is there at once; any other is fetched the first time. */
function useLanguage(language: string): Extension | undefined {
	const [loaded, setLoaded] = useState<Extension>();

	useEffect(() => {
		let current = true;
		setLoaded(undefined);

		void languages
			.find((known) => known.alias.includes(language) || known.name.toLowerCase() === language)
			?.load()
			.then((support) => {
				if (current) setLoaded(support);
			});

		return () => void (current = false);
	}, [language]);

	return written[language] ?? loaded;
}

/** A file as it stands: numbered, coloured for whatever the name says it is, and never editable. */
export function Read({ path, content }: { path: string; content: string }) {
	const language = usePathLanguage(path);

	return (
		<div data-slot="code" className="font-mono text-xs">
			<CodeMirror
				value={content}
				theme="dark"
				editable={false}
				extensions={language === undefined ? [] : [language]}
				basicSetup={{ ...setup, highlightActiveLine: false, highlightActiveLineGutter: false }}
			/>
		</div>
	);
}

/** The colouring for a name, fetched the first time a file of that language is opened. */
function usePathLanguage(path: string): Extension | undefined {
	const [language, setLanguage] = useState<Extension>();

	useEffect(() => {
		let current = true;
		setLanguage(undefined);

		void languageOf(path)
			?.load()
			.then((support) => {
				if (current) setLanguage(support);
			});

		return () => void (current = false);
	}, [path]);

	return language;
}

function languageOf(path: string) {
	const name = path.split("/").pop() ?? "";
	const extension = name.slice(name.lastIndexOf(".") + 1);

	return languages.find(
		(language) =>
			language.filename?.test(name) || (name.includes(".") && language.extensions.includes(extension)),
	);
}
