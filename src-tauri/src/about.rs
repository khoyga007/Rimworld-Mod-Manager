use anyhow::Result;
use quick_xml::events::Event;
use quick_xml::Reader;

#[derive(Debug, Clone, Default)]
pub struct ModAbout {
    pub package_id: String,
    pub name: String,
    pub author: String,
    pub description: String,
    pub supported_versions: Vec<String>,
    pub mod_dependencies: Vec<String>,
    pub load_after: Vec<String>,
    pub load_before: Vec<String>,
}

pub fn parse_about(xml_content: &str) -> Result<ModAbout> {
    let mut reader = Reader::from_str(xml_content);
    // reader.trim_text(true);

    let mut about = ModAbout::default();
    let mut buf = Vec::new();
    let mut path: Vec<String> = Vec::new();

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(ref e)) => {
                let name = String::from_utf8_lossy(e.name().as_ref()).to_string();
                path.push(name);
            }
            Ok(Event::End(_)) => {
                path.pop();
            }
            Ok(Event::Text(e)) => {
                let txt = e.unescape().unwrap_or_default().to_string();
                if txt.trim().is_empty() { continue; }
                
                let p = path.join("/");
                if p == "ModMetaData/packageId" { about.package_id = txt.to_lowercase(); }
                else if p == "ModMetaData/name" { about.name = txt; }
                else if p == "ModMetaData/author" { about.author = txt; }
                else if p == "ModMetaData/description" { about.description = txt; }
                else if p == "ModMetaData/supportedVersions/li" { about.supported_versions.push(txt); }
                else if p == "ModMetaData/modDependencies/li/packageId" || p == "ModMetaData/modDependencies/li" { 
                    about.mod_dependencies.push(txt.to_lowercase()); 
                }
                else if p == "ModMetaData/loadAfter/li" { about.load_after.push(txt.to_lowercase()); }
                else if p == "ModMetaData/loadBefore/li" { about.load_before.push(txt.to_lowercase()); }
            }
            Ok(Event::Eof) => break,
            Err(_) => break,
            _ => (),
        }
        buf.clear();
    }

    Ok(about)
}


